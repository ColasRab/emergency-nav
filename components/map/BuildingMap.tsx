"use client";
import {useEffect,useRef,useState} from "react";
import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import type {BuildingConfig} from "@/lib/buildings";
import type {NavGraph} from "@/lib/astar";
import {modelMercatorMatrix,type Vec3} from "@/lib/geo/transform";
import {loadScan,disposeObject,buildOverlay,setFloorVisibility,type OverlayPoint} from "@/lib/map/scene";
export default function BuildingMap({configs,activeId,floor,graph,path,user,points=[]}:{configs:BuildingConfig[];activeId:string;floor:number;graph:NavGraph|null;path:number[];user?:Vec3;points?:OverlayPoint[]}){
 const host=useRef<HTMLDivElement>(null),mapRef=useRef<mapboxgl.Map|null>(null),layers=useRef(new Map<string,{scene:THREE.Scene;model:THREE.Group;overlay:THREE.Group}>());
 const live=useRef({configs,activeId,floor,graph,path,user,points});live.current={configs,activeId,floor,graph,path,user,points};
 const [status,setStatus]=useState("Loading satellite map…"),[angled,setAngled]=useState(true);
 const active=configs.find(c=>c.id===activeId);
 useEffect(()=>{
  const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN,first=live.current.configs.find(c=>c.georef);
  if(!host.current||!token||!first?.georef)return;
  let disposed=false;const map=new mapboxgl.Map({container:host.current,accessToken:token,style:"mapbox://styles/mapbox/satellite-v9",center:first.georef.originLngLat,zoom:19,pitch:55,antialias:true});mapRef.current=map;
  const loading=new Set<string>();
  const sync=()=>{
   for(const config of live.current.configs){
    if(!config.georef||!config.glb||loading.has(config.id)||layers.current.has(config.id)||!map.getBounds()?.contains(config.georef.originLngLat))continue;
    loading.add(config.id);const start=performance.now();loadScan(config.glb).then(gltf=>{
     if(disposed){disposeObject(gltf.scene);return;}
     const scene=new THREE.Scene(),camera=new THREE.Camera(),model=gltf.scene,overlay=new THREE.Group();scene.add(model,overlay,new THREE.HemisphereLight(0xffffff,0x596775,3));let renderer:THREE.WebGLRenderer;
     const origin=mapboxgl.MercatorCoordinate.fromLngLat(config.georef!.originLngLat,config.georef!.altitudeM);
     const local=new THREE.Matrix4().fromArray(modelMercatorMatrix([origin.x,origin.y,origin.z],origin.meterInMercatorCoordinateUnits(),config));
     const layer:mapboxgl.CustomLayerInterface={id:`scan-${config.id}`,type:"custom",renderingMode:"3d",onAdd:(_map,gl)=>{renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl as WebGLRenderingContext,antialias:true});renderer.autoClear=false;},render:(_gl,matrix)=>{camera.projectionMatrix=new THREE.Matrix4().fromArray(matrix as number[]).multiply(local);renderer.resetState();renderer.render(scene,camera);},onRemove:()=>{disposeObject(scene);renderer?.dispose();layers.current.delete(config.id);}};
     map.addLayer(layer);layers.current.set(config.id,{scene,model,overlay});updateOverlays();map.triggerRepaint();setStatus(`3D model loaded in ${((performance.now()-start)/1000).toFixed(1)} s`);
    }).catch(()=>{loading.delete(config.id);if(!disposed)setStatus(`Unable to load ${config.name}.`);});
   }
  };
  const updateOverlays=()=>{const l=live.current;for(const config of l.configs){const s=layers.current.get(config.id);if(!s)continue;setFloorVisibility(s.model,l.floor);s.scene.remove(s.overlay);disposeObject(s.overlay);s.overlay=buildOverlay(config,config.id===l.activeId?l.graph:null,config.id===l.activeId?l.path:[],l.floor,false,config.id===l.activeId?l.user:undefined,config.id===l.activeId?l.points:[]);s.scene.add(s.overlay);}};
  map.on("load",()=>{setStatus("Satellite map ready");sync();});map.on("moveend",sync);map.on("error",e=>setStatus(e.error.message));const lost=(e:Event)=>{e.preventDefault();setStatus("Map graphics paused. Reload or use the location list.");};map.getCanvas().addEventListener("webglcontextlost",lost);
  const handler=()=>{updateOverlays();map.triggerRepaint();};map.getCanvas().addEventListener("navigation-overlay",handler);
  return()=>{disposed=true;map.getCanvas().removeEventListener("webglcontextlost",lost);map.getCanvas().removeEventListener("navigation-overlay",handler);map.remove();mapRef.current=null;layers.current.clear();};
 },[configs.map(c=>JSON.stringify(c.georef)).join("|")]);
 useEffect(()=>{mapRef.current?.getCanvas().dispatchEvent(new Event("navigation-overlay"));},[activeId,floor,graph,path,user,points,configs]);
 useEffect(()=>{if(active?.georef)mapRef.current?.flyTo({center:active.georef.originLngLat,zoom:19,pitch:angled?55:0});},[active,angled]);
 if(!process.env.NEXT_PUBLIC_MAPBOX_TOKEN)return <p className="status-warning">Add a Mapbox public token to enable the satellite map.</p>;
 if(!configs.some(c=>c.georef))return <div className="empty-state">Satellite placement needs three surveyed control points per building. You can inspect both scans below and add control points in <a href="/admin/alignment">Alignment setup</a>.</div>;
 return <div><div ref={host} className="map-canvas"/><div className="viewer-footer"><span role="status">{status}</span><button className="secondary-button" onClick={()=>setAngled(p=>!p)}>{angled?"Top-down":"Angled"}</button></div>{active?.georef&&active.georef.residualRmsM>3&&<p className="status-warning">Alignment RMS exceeds 3 m. Recheck the survey points.</p>}</div>;
}
