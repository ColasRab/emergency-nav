"use client";
import {useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import type {BuildingConfig} from "@/lib/buildings";
import type {NavGraph} from "@/lib/astar";
import type {Vec3} from "@/lib/geo/transform";
import {buildOverlay,disposeObject,loadScan,setFloorVisibility,type OverlayPoint} from "@/lib/map/scene";
export type ModelHit={position:Vec3;normal:[number,number]};
export default function ScanViewer({config,graph=null,path=[],floor=0,showGraph=false,points=[],user,onPick}:{config:BuildingConfig;graph?:NavGraph|null;path?:number[];floor?:number;showGraph?:boolean;points?:OverlayPoint[];user?:Vec3;onPick?:(hit:ModelHit)=>void}){
 const host=useRef<HTMLDivElement>(null),state=useRef<{scene:THREE.Scene;model:THREE.Group;overlay:THREE.Group;render:()=>void}|null>(null);
 const latest=useRef({config,graph,path,floor,showGraph,points,user,onPick});latest.current={config,graph,path,floor,showGraph,points,user,onPick};
 const [status,setStatus]=useState("Loading scan…"),[preset,setPreset]=useState(false);
 useEffect(()=>{
  if(!host.current||!config.glb)return;let stopped=false,renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setStatus("3D preview unavailable on this device. Use the location list.");return;}
  const container=host.current;renderer.setPixelRatio(Math.min(devicePixelRatio,2));container.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color("#111b26");scene.add(new THREE.HemisphereLight(0xffffff,0x536575,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(10,20,10);scene.add(light);
  const camera=new THREE.PerspectiveCamera(50,1,.01,2000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  let overlay=new THREE.Group(),model=new THREE.Group();scene.add(overlay,model);
  const render=()=>{if(!stopped)renderer.render(scene,camera);};controls.addEventListener("change",render);
  const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();});resize.observe(container);
  const lost=(e:Event)=>{e.preventDefault();setStatus("3D graphics paused. Reload the preview to reconnect.");};renderer.domElement.addEventListener("webglcontextlost",lost);
  let down:[number,number]=[0,0];const pointerDown=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};
  const pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>5||!latest.current.onPick)return;const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObject(model,true)[0];if(!hit?.face)return;const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);if(Math.hypot(normal.x,normal.z)<.5){setStatus("Choose a wall surface, away from the floor or ceiling.");return;}const n=Math.hypot(normal.x,normal.z);latest.current.onPick({position:hit.point.toArray() as Vec3,normal:[normal.x/n,normal.z/n]});};
  renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("pointerup",pick);
  const started=performance.now();loadScan(config.glb).then(gltf=>{if(stopped){disposeObject(gltf.scene);return;}scene.remove(model);model=gltf.scene;scene.add(model);const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size*.5,preset?size:size*.6,preset?.001:size*.5));camera.lookAt(center);camera.far=Math.max(200,size*20);camera.updateProjectionMatrix();setFloorVisibility(model,latest.current.floor);state.current={scene,model,overlay,render};const l=latest.current;scene.remove(overlay);disposeObject(overlay);overlay=buildOverlay(l.config,l.graph,l.path,l.floor,l.showGraph,l.user,l.points);scene.add(overlay);state.current.overlay=overlay;render();setStatus(`Loaded in ${((performance.now()-started)/1000).toFixed(1)} s · ${config.modelVerified?"surveyed model":"scale and floors unverified"}`);}).catch(()=>{if(!stopped)setStatus("Unable to load this scan. Check the model conversion report.");});
  return()=>{stopped=true;state.current=null;resize.disconnect();controls.dispose();disposeObject(scene);renderer.dispose();renderer.domElement.removeEventListener("webglcontextlost",lost);renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("pointerup",pick);renderer.domElement.remove();};
 },[config.id,config.glb,config.modelVerified,preset]);
 useEffect(()=>{const s=state.current;if(!s)return;setFloorVisibility(s.model,floor);s.scene.remove(s.overlay);disposeObject(s.overlay);s.overlay=buildOverlay(config,graph,path,floor,showGraph,user,points);s.scene.add(s.overlay);s.render();},[config,graph,path,floor,showGraph,user,points]);
 return <div className="scan-panel"><div ref={host} className="scan-canvas"/><div className="viewer-footer"><span role="status">{status}</span><button className="secondary-button" onClick={()=>setPreset(p=>!p)}>{preset?"Angled view":"Top-down view"}</button></div></div>;
}
