"""Survey-driven multi-floor graph maker, using the user's existing Python utilities.

Run with the emergency-navigation .venv and a filled survey JSON. Original main.py,
scan assets, exits and graphs are never overwritten unless --out explicitly names them.
"""
from __future__ import annotations
import argparse,importlib.util,json,sys
from pathlib import Path
import numpy as np
from scipy import ndimage

def build(survey_path:Path,out:Path):
    survey=json.loads(survey_path.read_text(encoding='utf-8-sig'))
    if survey['buildingId'] not in ('admin','ynares'): raise ValueError('Unknown building')
    if not isinstance(survey.get('metersPerUnit'),(int,float)) or survey['metersPerUnit']<=0: raise ValueError('Set a measured metersPerUnit; scale cannot be guessed.')
    if survey.get('upAxis') not in ('X','Y','Z'): raise ValueError('Confirm the source upAxis first.')
    source_dir=Path(survey['pythonSourceDir']).resolve()
    sys.path.insert(0,str(source_dir))
    spec=importlib.util.spec_from_file_location('existing_nav_pipeline',source_dir/'main.py')
    pipeline=importlib.util.module_from_spec(spec);sys.modules[spec.name]=pipeline;spec.loader.exec_module(pipeline)
    vertices=pipeline.load_vertices(survey['obj'])
    if survey['upAxis']=='Z': vertices=vertices[:,[0,2,1]]*np.array([1,1,-1])
    if survey['upAxis']=='X': vertices=vertices[:,[1,0,2]]*np.array([-1,1,1])
    origin=survey.get('origin',[0,0,0])
    if not isinstance(origin,list) or len(origin)!=3 or any(not isinstance(v,(int,float)) or not np.isfinite(v) for v in origin):raise ValueError('Set the measured model origin [x,y,z]; its Y coordinate must match the first-floor walking surface after reorientation.')
    vertices=(vertices-np.array(origin))*survey['metersPerUnit']
    resolution=float(survey.get('resolution',.1))
    if resolution<.05: raise ValueError('Use resolution >= 0.05m to bound graph memory.')
    floors=survey['floors'];indices=[f['index'] for f in floors]
    if len(indices)!=len(set(indices)):raise ValueError('Floor indices must be unique.')
    if not any(f.get('exits') for f in floors):raise ValueError('Supply at least one surveyed real exit; exits are never auto-picked.')
    all_nodes,all_edges,all_zones,all_exits={}, {}, {}, []
    locators={};node_offset=0
    x,z=vertices[:,0],vertices[:,2];ox,oz=float(x.min()),float(z.min())
    width=int(np.ceil(np.ptp(x)/resolution))+1;height=int(np.ceil(np.ptp(z)/resolution))+1
    if width*height>4000000:raise ValueError('Grid too large. Check scan scale/resolution.')
    gx=np.floor((x-ox)/resolution+1e-7).astype(int);gz=np.floor((z-oz)/resolution+1e-7).astype(int)
    max_snap=float(survey.get('maxSnapM',1))
    def snap(floor,position):
        locator,offset=locators[floor];nid=locator.nearest(*position)
        p=all_nodes[str(nid+offset)]
        if np.hypot(p[0]-position[0],p[1]-position[1])>max_snap:raise ValueError(f'Survey point {position} on floor {floor} is not near walkable graph. Inspect masks, scale and doors.')
        return nid+offset
    floor_diagnostics=[]
    for floor in floors:
        if not isinstance(floor.get('baseY'),(int,float)) or not isinstance(floor.get('height'),(int,float)) or floor['height']<=0:raise ValueError('Supply surveyed baseY and height for every floor.')
        h=vertices[:,1]-floor['baseY'];fb=floor.get('floorBand',[-.15,.15]);bb=floor.get('bodyBand',[.2,1.8])
        inside=np.zeros((height,width),dtype=bool);obstacle=inside.copy()
        mask=(h>=fb[0])&(h<=fb[1]);inside[gz[mask],gx[mask]]=True
        mask=(h>=bb[0])&(h<=bb[1]);obstacle[gz[mask],gx[mask]]=True
        inside=ndimage.binary_closing(inside,iterations=1)
        # No global largest-island filter: it could erase real rooms or landings.
        walkable=inside&~obstacle
        if not walkable.any():raise ValueError(f'No walkable cells on floor {floor["index"]}; review the scan and floor bands.')
        points,id_grid=pipeline.create_points(walkable,resolution,ox,oz)
        hazard_grid=pipeline.compute_hazard_grid(walkable,resolution)
        edges=pipeline.assign_weighted_edges(walkable,id_grid,resolution,hazard_grid)
        cells={int(id_grid[r,c]):(r,c) for r,c in zip(*np.where(walkable))}
        # Prevent diagonal shortcuts through an obstacle at a grid corner.
        for nid,links in edges.items():
            r,c=cells[nid];safe=[]
            for dest,weight in links:
                nr,nc=cells[dest]
                if nr!=r and nc!=c and not(walkable[nr,c] and walkable[r,nc]):continue
                safe.append([dest+node_offset,float(weight)])
            all_edges[str(nid+node_offset)]=safe
        for nid,(px,pz) in points.items():all_nodes[str(nid+node_offset)]=[float(px),float(pz),int(floor['index'])]
        locators[floor['index']]=(pipeline.PointLocator(points),node_offset)
        node_offset+=len(points)
        labels=set()
        for zone in floor.get('zones',[]):
            label=zone['label'].strip()
            if not label or label.casefold() in labels:raise ValueError('Zone labels must be unique within each floor.')
            labels.add(label.casefold());nid=snap(floor['index'],zone['position'])
            if str(nid) in all_zones:raise ValueError('Two zone anchors snap to the same node. Separate their survey positions.')
            all_zones[str(nid)]={'label':label,'type':zone['type']}
        all_exits.extend(snap(floor['index'],p) for p in floor.get('exits',[]))
        floor_diagnostics.append({'floor':floor['index'],'nodes':len(points),'components':int(ndimage.label(walkable)[1])})
    for stair in survey.get('stairs',[]):
        a=stair['from'];b=stair['to'];start=snap(a['floor'],a['position']);end=snap(b['floor'],b['position'])
        distance=float(stair['walkingDistanceM'])
        if distance<=0 or a['floor']==b['floor']:raise ValueError('Stair connectors require different floors and measured walkingDistanceM.')
        all_edges[str(start)].append([end,distance]);all_edges[str(end)].append([start,distance])
    reachable=set(all_exits);front=list(reachable)
    while front:
        for nid,_ in all_edges[str(front.pop())]:
            if nid not in reachable:reachable.add(nid);front.append(nid)
    data={'meta':{'buildingId':survey['buildingId'],'version':2,'units':'meters','resolution':resolution,'origin_x':ox,'origin_z':oz},'nodes':all_nodes,'edges':all_edges,'exits':sorted(set(all_exits)),'zones':all_zones}
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(data,separators=(',',':')))
    diagnostics={'buildingId':survey['buildingId'],'floors':floor_diagnostics,'unreachableNodes':len(all_nodes)-len(reachable),'verified':False,'note':'Inspect paths against walls, stairs and real exits before marking the building graph verified.'}
    out.with_suffix('.inspection.json').write_text(json.dumps(diagnostics,indent=2));print(json.dumps(diagnostics,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('survey',type=Path);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();build(args.survey,args.out)
