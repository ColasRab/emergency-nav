import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { BuildingConfig } from "../buildings";
import type { NavGraph } from "../astar";
import { graphToModel, type Vec3 } from "../geo/transform";

export function loadScan(url:string){return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);}
export function disposeObject(object:THREE.Object3D){object.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Points){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof THREE.Texture)value.dispose();m.dispose();}}});}
export function setFloorVisibility(root:THREE.Object3D,floor:number){
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const name=o.parent?.name??o.name;const match=(name.match(/^floor_(-?\d+)/)??o.name.match(/^floor_(-?\d+)/));if(!match)return;const level=Number(match[1]);o.visible=level<=floor;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=level<floor;m.opacity=level<floor?.18:1;m.depthWrite=level===floor;}});
}
export type OverlayPoint={position:Vec3;color:string;radius?:number};
export function buildOverlay(config:BuildingConfig,graph:NavGraph|null,path:number[],floor:number,showGraph:boolean,user?:Vec3,points:OverlayPoint[]=[]){
  const root=new THREE.Group();
  if(graph&&config.graphToModel){
    if(showGraph){const vertices:number[]=[];for(const node of Object.values(graph.nodes))if(node[2]===floor)vertices.push(...graphToModel(node,config,.08));const geometry=new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));root.add(new THREE.Points(geometry,new THREE.PointsMaterial({color:0x50c9fa,size:.07,sizeAttenuation:true,depthTest:false})));}
    for(let i=1;i<path.length;i++){const a=graph.nodes[path[i-1]],b=graph.nodes[path[i]];if(a[2]!==floor&&b[2]!==floor)continue;const start=new THREE.Vector3(...graphToModel(a,config,.3)),end=new THREE.Vector3(...graphToModel(b,config,.3));if(start.distanceTo(end)<.001)continue;const curve=new THREE.LineCurve3(start,end);root.add(new THREE.Mesh(new THREE.TubeGeometry(curve,1,.045,5,false),new THREE.MeshBasicMaterial({color:0x35e895,depthTest:false})));}
    for(const id of graph.exits)if(graph.nodes[id]?.[2]===floor)points=[...points,{position:graphToModel(graph.nodes[id],config,.3),color:"#37e895",radius:.18}];
    if(user)points=[...points,{position:graphToModel(user,config,.35),color:"#59aaff",radius:.18}];
  }
  for(const point of points)root.add(new THREE.Mesh(new THREE.SphereGeometry(point.radius??.12,8,6),new THREE.MeshBasicMaterial({color:point.color,depthTest:false})).translateX(point.position[0]).translateY(point.position[1]).translateZ(point.position[2]));
  root.renderOrder=10;return root;
}
