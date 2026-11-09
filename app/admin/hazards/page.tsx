"use client";
import {useState} from "react";
import AdminNav from "@/components/admin/AdminNav";
import HazardReport from "@/components/HazardReport";
import HazardList from "@/components/HazardList";
import {useHazards} from "@/lib/hazards/client";
import {useBuildingData} from "@/lib/clientData";
import type {BuildingId} from "@/lib/buildings";
export default function HazardsPage(){const [id,setId]=useState<BuildingId>("ynares"),{config,graph,error}=useBuildingData(id),store=useHazards(id),[node,setNode]=useState<number|null>(null);const current=graph?.nodes[node??-1];return <main className="wide-main"><AdminNav/><h1>Hazard administration</h1><p className="subtitle">Review reports and manage persistent closures. The admin access token is configured on the server and stays in memory here.</p><label>Building<select value={id} onChange={e=>{setId(e.target.value as BuildingId);setNode(null);}}><option value="admin">Admin Building</option><option value="ynares">Ynares Building</option></select></label><p role="status">{store.status}</p>{error&&<p>{error}</p>}{graph&&config&&<><label>Report location<select value={node??""} onChange={e=>setNode(Number(e.target.value))}><option value="" disabled>Choose a mapped point</option>{Object.entries(graph.zones).map(([id,tag])=><option key={id} value={id}>{tag.label} · Floor {graph.nodes[id][2]}</option>)}</select></label>{current&&<HazardReport graph={graph} config={config} position={[current[0],current[1]]} floor={current[2]} heading={null} onCreate={store.create} admin/>}</>}<HazardList hazards={store.hazards} onAction={store.act} admin/></main>;}
