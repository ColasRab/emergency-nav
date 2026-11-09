import type {NavGraph} from "./astar";
const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
export type ZoneMatch={nodeId:number;label:string};
export function matchZone(graph:NavGraph,text:string,floor:number,exact=false):ZoneMatch|null{
 const cleaned=` ${normalize(text)} `;
 const matches=Object.entries(graph.zones).filter(([id,tag])=>graph.nodes[id]?.[2]===floor&&(exact?normalize(text)===normalize(tag.label):cleaned.includes(` ${normalize(tag.label)} `))).sort((a,b)=>normalize(b[1].label).length-normalize(a[1].label).length);
 // Identical labels on the same floor remain ambiguous; require a unique anchor instead.
 if(!matches.length)return null;const label=normalize(matches[0][1].label);if(matches.filter(([,t])=>normalize(t.label)===label).length>1)return null;
 return {nodeId:Number(matches[0][0]),label:matches[0][1].label};
}
