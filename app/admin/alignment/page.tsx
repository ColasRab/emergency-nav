"use client";
import dynamic from "next/dynamic";
import {useEffect,useState} from "react";
import AdminNav from "@/components/admin/AdminNav";
import {useBuildingData,saveConfigDraft,downloadFile} from "@/lib/clientData";
import {buildingSchema,type BuildingId,type BuildingConfig} from "@/lib/buildings";
import {fitGeoreference,fitSimilarity,type Vec2} from "@/lib/geo/transform";
const ScanViewer=dynamic(()=>import("@/components/map/ScanViewer"),{ssr:false});
const BuildingMap=dynamic(()=>import("@/components/map/BuildingMap"),{ssr:false});
export default function AlignmentPage(){
 const [id,setId]=useState<BuildingId>("admin"),{config,graph,error}=useBuildingData(id);
 const [draft,setDraft]=useState<BuildingConfig|null>(null),[text,setText]=useState(""),[gcps,setGcps]=useState("[]"),[pairs,setPairs]=useState("[]"),[status,setStatus]=useState(""),[floor,setFloor]=useState(0);
 useEffect(()=>{if(config){setDraft(config);setText(JSON.stringify(config,null,2));setFloor(config.floors[0].index);}},[config]);
 function update(c:BuildingConfig){setDraft(c);setText(JSON.stringify(c,null,2));}
 function solve(kind:"geo"|"graph"){if(!draft)return;try{if(kind==="geo"){const input=JSON.parse(gcps) as {model:Vec2;lngLat:Vec2}[];const {residuals,...georef}=fitGeoreference(input,draft.georef?.altitudeM??0);update({...draft,georef});setStatus(`GCP residuals: ${residuals.map(n=>n.toFixed(2)).join(", ")} m · RMS ${georef.residualRmsM.toFixed(2)} m${georef.residualRmsM>3?" — re-survey required":""}`);}else{const result=fitSimilarity(JSON.parse(pairs));const {residuals,rms,...graphToModel}=result;update({...draft,graphToModel});setStatus(`Graph alignment RMS ${rms.toFixed(3)} model units · residuals ${residuals.map(n=>n.toFixed(2)).join(", ")}`);}}catch(e){setStatus(e instanceof Error?e.message:"Invalid survey points");}}
 return <main className="wide-main"><AdminNav/><h1>Building alignment</h1><p className="subtitle">Survey the scan before using its position for guidance. Changes saved here stay in this browser; export the final configuration for deployment.</p><label>Building<select value={id} onChange={e=>setId(e.target.value as BuildingId)}><option value="admin">Admin Building</option><option value="ynares">Ynares Building</option></select></label>{error&&<p role="alert">{error}</p>}{draft&&<>
 <label>Preview floor<select value={floor} onChange={e=>setFloor(Number(e.target.value))}>{draft.floors.map(f=><option key={f.index} value={f.index}>Floor {f.index}</option>)}</select></label>
 <ScanViewer config={draft} graph={graph} floor={floor} showGraph/>{!draft.graphToModel&&<p className="status-warning">Add graph/model correspondences to display the graph over the scan.</p>}
 <BuildingMap configs={[draft]} activeId={id} floor={floor} graph={graph} path={[]}/>
 <section className="status-card"><h2>Ground control points</h2><p>At least three non-collinear points. Format: <code>{'[{"model":[x,z],"lngLat":[longitude,latitude]}, ...]'}</code>. Model units must already match the conversion settings. Set the surveyed ground altitude in the configuration below.</p><textarea aria-label="Ground control points" value={gcps} onChange={e=>setGcps(e.target.value)}/><button onClick={()=>solve("geo")}>Fit geographic alignment</button></section>
 <section className="status-card"><h2>Graph to model</h2><p>Match three or more known graph locations to scan locations: <code>{'[{"source":[graphX,graphZ],"target":[modelX,modelZ]}, ...]'}</code></p><textarea aria-label="Graph correspondence points" value={pairs} onChange={e=>setPairs(e.target.value)}/><button onClick={()=>solve("graph")}>Fit graph alignment</button></section>
 <section className="status-card"><h2>Survey configuration</h2><p>Set measured floor elevations and heights, model scale, and graph path. Mark verification flags true only after checking floor alignment, actual exits, stair connectors and scale in the building. Until floors are surveyed and the conversion rerun, the scan remains one unsplit preview.</p><textarea className="config-editor" aria-label="Building configuration" value={text} onChange={e=>setText(e.target.value)}/><div className="button-row"><button onClick={()=>{try{const c=buildingSchema.parse(JSON.parse(text));if(c.id!==id)throw new Error("Building ID must match the selected building.");update(c);saveConfigDraft(c);setStatus("Saved browser draft. Export the file to deploy it.");}catch(e){setStatus(e instanceof Error?e.message:"Invalid configuration");}}}>Apply browser draft</button><button onClick={()=>{try{downloadFile(`${id}.json`,JSON.stringify(buildingSchema.parse(JSON.parse(text)),null,2));}catch{setStatus("Fix configuration errors before exporting.");}}}>Export configuration</button></div></section>
 </>}<p role="status">{status}</p></main>;
}
