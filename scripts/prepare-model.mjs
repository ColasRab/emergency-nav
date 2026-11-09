/** Repeatable non-destructive OBJ/PLY -> meshopt GLB. Original scans are never written.
 * Set surveyed upAxis, metersPerUnit, origin and floor intervals in the manifest.
 * Without verified floors the entire scan is explicitly named unassigned_scan.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import {PLYLoader} from 'three/examples/jsm/loaders/PLYLoader.js';
import {Document,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,EXTTextureWebP} from '@gltf-transform/extensions';
import {weld,simplify,dedup,prune,meshopt,normals} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';

await Promise.all([MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const manifest=JSON.parse(await fs.readFile(process.argv[2]??'scripts/model-manifest.json','utf8'));
const only=process.argv[3];
const results=[];
for(const spec of manifest.models.filter(s=>!only||s.id===only)){
  const started=performance.now();
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(spec.id);
  let material=doc.createMaterial().setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0).setBaseColorFactor([.72,.76,.8,1]);
  if(spec.texture){
    const bytes=await sharp(spec.texture).resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const texture=doc.createTexture().setImage(bytes).setMimeType('image/webp');
    material.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]);
  }
  const data=await fs.readFile(spec.source);
  const geometries=[];
  if(path.extname(spec.source).toLowerCase()==='.ply'){
    geometries.push(new PLYLoader().parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)));
  }else{
    const object=new OBJLoader().parse(data.toString('utf8'));
    object.traverse(child=>{if(child.isMesh)geometries.push(child.geometry);});
  }
  let originalTriangles=0;
  for(const source of geometries){
    const geometry=source.index?source.toNonIndexed():source;
    const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    originalTriangles+=position.count/3;
    const buckets=new Map();
    for(let i=0;i<position.count;i+=3){
      const positions=[],normals=[],uvs=[];
      for(let j=0;j<3;j++){
        let p=[position.getX(i+j),position.getY(i+j),position.getZ(i+j)];
        let n=normal?[normal.getX(i+j),normal.getY(i+j),normal.getZ(i+j)]:null;
        if(spec.upAxis==='Z'){p=[p[0],p[2],-p[1]];if(n)n=[n[0],n[2],-n[1]];}
        if(spec.upAxis==='X'){p=[-p[1],p[0],p[2]];if(n)n=[-n[1],n[0],n[2]];}
        p=p.map((v,k)=>(v-spec.origin[k])*spec.metersPerUnit);
        positions.push(...p);if(n)normals.push(...n);if(uv)uvs.push(uv.getX(i+j),1-uv.getY(i+j));
      }
      const y=(positions[1]+positions[4]+positions[7])/3;
      const floor=spec.floors.find(f=>y>=f.baseY && y<f.baseY+f.height);
      const name=floor?`floor_${floor.index}`:'unassigned_scan';
      if(!buckets.has(name))buckets.set(name,{positions:[],normals:[],uvs:[]});
      const bucket=buckets.get(name);bucket.positions.push(...positions);bucket.normals.push(...normals);bucket.uvs.push(...uvs);
    }
    for(const [name,b] of buckets){
      const primitive=doc.createPrimitive().setMaterial(material);
      primitive.setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.positions)).setBuffer(buffer));
      if(b.normals.length && spec.texture)primitive.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.normals)).setBuffer(buffer));
      if(b.uvs.length && spec.texture)primitive.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(b.uvs)).setBuffer(buffer));
      const mesh=doc.createMesh(name).addPrimitive(primitive);
      scene.addChild(doc.createNode(name).setMesh(mesh).setExtras({units:spec.verified?'meters':'unverified scan units'}));
    }
  }
  await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:Math.min(1,280000/originalTriangles),error:.01,lockBorder:false}),normals(),dedup(),prune());
  const triangles=doc.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
  await doc.transform(meshopt({encoder:MeshoptEncoder,level:'high'}));
  const out=`public/models/${spec.id}.glb`;
  await fs.mkdir(path.dirname(out),{recursive:true});
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder}).write(out,doc);
  const bytes=(await fs.stat(out)).size;
  const result={id:spec.id,originalTriangles,triangles,bytes,conversionSeconds:(performance.now()-started)/1000,verified:spec.verified,withinBudget:triangles<300000&&bytes<25000000};
  results.push(result);console.log(JSON.stringify(result));
  if(!result.withinBudget)process.exitCode=2;
}
await fs.mkdir('reports',{recursive:true});
await fs.writeFile(`reports/model-conversion${only?'-'+only:''}.json`,JSON.stringify(results,null,2));
