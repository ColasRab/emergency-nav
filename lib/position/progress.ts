import type {NavGraph} from "../astar";
import type {Vec2} from "../geo/transform";
export function distanceToPath(graph:NavGraph,path:number[],position:Vec2,floor:number,metersPerUnit=1):number{
 let best=Infinity;for(let i=0;i<path.length;i++){const a=graph.nodes[path[i]];if(a[2]!==floor)continue;const b=graph.nodes[path[i+1]];if(!b||b[2]!==floor){best=Math.min(best,Math.hypot(a[0]-position[0],a[1]-position[1]));continue;}const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz,t=length?Math.min(1,Math.max(0,((position[0]-a[0])*dx+(position[1]-a[1])*dz)/length)):0;best=Math.min(best,Math.hypot(a[0]+t*dx-position[0],a[1]+t*dz-position[1]));}return best*metersPerUnit;
}
