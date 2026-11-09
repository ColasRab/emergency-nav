"use client";
import {useCallback,useEffect,useState,useRef} from "react";
import {createClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {BuildingId} from "../buildings";
import {hazardSchema,isActive,type Hazard} from "./model";
type Command={action:"create";hazard:Hazard;confirmed:boolean}|{action:"confirm"|"dismiss"|"expire";id:string;adminToken?:string};
const storageKey=(id:BuildingId)=>`wayfinder:hazards:${id}:v1`;
export function useHazards(buildingId:BuildingId){
 const [hazards,setHazards]=useState<Hazard[]>([]),[status,setStatus]=useState("Connecting to shared hazards…"),[shared,setShared]=useState(false),pending=useRef<Command[]>([]),local=useRef<Hazard[]>([]),busy=useRef(false),current=useRef(buildingId);current.current=buildingId;
 const persist=useCallback(()=>{try{localStorage.setItem(storageKey(buildingId),JSON.stringify({hazards:local.current,pending:pending.current.filter(p=>!("adminToken"in p))}));}catch{/* In-memory fallback remains usable. */}},[buildingId]);
 const refresh=useCallback(async()=>{if(busy.current)return;busy.current=true;try{
  for(const command of [...pending.current]){
   const body=command.action==="create"?{action:"create",...command.hazard,confirmed:command.confirmed}:{action:command.action,id:command.id,buildingId};
   const token="adminToken"in command?command.adminToken:undefined;
   const response=await fetch("/api/hazards",{method:"POST",headers:{"Content-Type":"application/json",...(token?{"x-hazard-admin":token}:{})},body:JSON.stringify(body)});
   if(current.current!==buildingId)return;
   if(response.ok){const data=await response.json();const h=hazardSchema.parse(data.hazard);local.current=[...local.current.filter(x=>x.id!==h.id),h];pending.current=pending.current.filter(p=>p!==command);}
   else if(response.status>=400&&response.status<500){pending.current=pending.current.filter(p=>p!==command);if(command.action==="create")local.current=local.current.filter(h=>h.id!==command.hazard.id);setStatus((await response.json()).message??"Report was rejected.");}
   else break;
  }
  const response=await fetch(`/api/hazards?buildingId=${buildingId}`,{cache:"no-store"});if(!response.ok)throw new Error("Shared connection unavailable");const data=await response.json();if(current.current!==buildingId)return;
  const rows=z.array(hazardSchema).parse(data.hazards),unsynced=local.current.filter(h=>pending.current.some(p=>p.action==="create"&&p.hazard.id===h.id));local.current=[...rows,...unsynced];setShared(true);setStatus(pending.current.length?"Shared hazards connected; syncing pending changes…":"Shared hazards connected");
 }catch{if(current.current===buildingId){setShared(false);setStatus("Offline hazards on this device · reports will sync when connected");}}finally{if(current.current===buildingId){local.current=local.current.filter(h=>isActive(h,Date.now()));setHazards([...local.current]);persist();}busy.current=false;}},[buildingId,persist]);
 useEffect(()=>{busy.current=false;pending.current=[];local.current=[];setHazards([]);try{const saved=JSON.parse(localStorage.getItem(storageKey(buildingId))??"{}");local.current=z.array(hazardSchema).parse(saved.hazards??[]);pending.current=Array.isArray(saved.pending)?saved.pending:[];}catch{pending.current=[];local.current=[];}setHazards(local.current.filter(h=>isActive(h,Date.now())));void refresh();const interval=setInterval(()=>void refresh(),4000);const online=()=>void refresh();window.addEventListener("online",online);let remove=()=>{};const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(url&&key){const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const channel=client.channel(`hazards-${buildingId}`).on("postgres_changes",{event:"*",schema:"public",table:"hazards",filter:`buildingId=eq.${buildingId}`},()=>void refresh()).subscribe();remove=()=>{void client.removeChannel(channel);};}return()=>{clearInterval(interval);window.removeEventListener("online",online);remove();};},[buildingId,refresh]);
 const create=useCallback((hazard:Hazard,confirmed=false,adminToken?:string)=>{local.current=[...local.current.filter(h=>h.id!==hazard.id),hazard];const command:Command={action:"create",hazard,confirmed};if(adminToken)Object.assign(command,{adminToken});pending.current.push(command);setHazards([...local.current]);persist();void refresh();},[persist,refresh]);
 const act=useCallback((id:string,action:"confirm"|"dismiss"|"expire",adminToken?:string)=>{pending.current.push({id,action,...(adminToken?{adminToken}:{})});const h=local.current.find(x=>x.id===id);if(h&&action==="expire"&&adminToken)h.expiresAt=Date.now();setHazards([...local.current]);persist();void refresh();},[persist,refresh]);
 return {hazards,status,shared,create,act,refresh};
}
