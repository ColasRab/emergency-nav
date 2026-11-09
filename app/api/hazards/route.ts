import {NextRequest,NextResponse} from "next/server";
import {createHash,randomUUID,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {serverSupabase,serverBuilding} from "@/lib/hazards/server";
import {hazardSchema,hazardTypes} from "@/lib/hazards/model";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const limits=new Map<string,{count:number;reset:number}>();
const inputSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("create"),id:z.string().uuid(),buildingId:z.enum(["admin","ynares"]),floor:z.number().int(),nodeIds:z.array(z.number().int().nonnegative()).min(1).max(1000),edge:z.tuple([z.number().int(),z.number().int()]).optional(),type:z.enum(hazardTypes),severity:z.union([z.literal(1),z.literal(2),z.literal(3)]),confidence:z.number().min(0).max(1),source:z.enum(["auto","user","admin"]),createdAt:z.number().int().nonnegative(),confirmed:z.boolean().default(false)}),
 z.object({action:z.enum(["confirm","dismiss","expire"]),id:z.string().uuid(),buildingId:z.enum(["admin","ynares"])}),
]);
const publicHazard=(row:unknown)=>{const data=row as Record<string,unknown>;return hazardSchema.parse({...data,edge:data.edge??undefined});};
export async function GET(request:NextRequest){try{const id=z.enum(["admin","ynares"]).parse(request.nextUrl.searchParams.get("buildingId"));const client=serverSupabase();const {data,error}=await client.from("hazards").select("*").eq("buildingId",id).gt("expiresAt",Date.now()).limit(2000);if(error)throw error;return NextResponse.json({hazards:(data??[]).map(publicHazard),shared:true},{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({hazards:[],shared:false,message:"Shared hazards unavailable. Check connection and database setup."},{status:503});}}
export async function POST(request:NextRequest){
 try{
  if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({message:"Origin not allowed"},{status:403});
  const raw=await request.text();if(raw.length>32000)return NextResponse.json({message:"Report too large"},{status:413});const input=inputSchema.parse(JSON.parse(raw));
  const now=Date.now(),cookie=request.cookies.get("wayfinder-reporter")?.value,visitor=cookie&&/^[0-9a-f-]{36}$/.test(cookie)?cookie:randomUUID(),voter=createHash("sha256").update(visitor).digest("hex");
  for(const [key,value]of limits)if(value.reset<now)limits.delete(key);
  const rate=limits.get(voter)??{count:0,reset:now+60000};if(++rate.count>30)return NextResponse.json({message:"Too many reports. Try again shortly."},{status:429});limits.set(voter,rate);
  const supplied=request.headers.get("x-hazard-admin")??"",expected=process.env.HAZARD_ADMIN_TOKEN??"",isAdmin=expected.length>=24&&supplied.length===expected.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  const client=serverSupabase();
  let result:unknown;
  if(input.action==="create"){
   if(input.source==="admin"&&!isAdmin)return NextResponse.json({message:"Admin authorization required"},{status:403});
   const {config,graph}=await serverBuilding(input.buildingId);if(!graph||!config.floors.some(f=>f.index===input.floor))return NextResponse.json({message:"Building graph or floor is unavailable."},{status:400});
   if(input.nodeIds.some(id=>!graph.nodes[id]||graph.nodes[id][2]!==input.floor))return NextResponse.json({message:"Affected nodes must belong to the selected floor."},{status:400});
   if(input.edge&&(!input.nodeIds.includes(input.edge[0])||!input.nodeIds.includes(input.edge[1])||!graph.edges[input.edge[0]]?.some(([id])=>id===input.edge![1])))return NextResponse.json({message:"Invalid affected edge"},{status:400});
   const createdAt=Math.min(now,input.createdAt),expiresAt=input.source==="admin"?Number.MAX_SAFE_INTEGER:createdAt+(input.type==="crowd"?config.settings.crowd.ttlMs:config.settings.hazards.ttlMs);
   if(expiresAt<=now)return NextResponse.json({message:"The offline report has expired."},{status:410});
   const hazard=hazardSchema.parse({...input,createdAt,expiresAt,confirmations:0,dismissals:0});
   const {data:existing,error:lookupError}=await client.from("hazards").select("*").eq("id",input.id).maybeSingle();if(lookupError)throw lookupError;
   // Idempotent offline retries cannot overwrite an admin decision or extend TTL.
   if(existing)result=existing;else{const {data,error}=await client.from("hazards").insert({...hazard,edge:hazard.edge??null}).select().single();if(error)throw error;result=data;}
   if(input.source==="user"||input.confirmed||input.source==="admin"){const {data,error}=await client.rpc("vote_hazard",{p_id:input.id,p_voter:voter,p_value:1});if(error)throw error;result=data;}
  }else{
   const {data:row,error:readError}=await client.from("hazards").select("*").eq("id",input.id).eq("buildingId",input.buildingId).single();if(readError||!row)return NextResponse.json({message:"Hazard not found"},{status:404});
   if(input.action==="expire"){if(!isAdmin)return NextResponse.json({message:"Admin authorization required"},{status:403});const {data,error}=await client.from("hazards").update({expiresAt:now}).eq("id",input.id).select().single();if(error)throw error;result=data;}
   else{if(row.source==="admin"&&!isAdmin&&input.action==="dismiss")return NextResponse.json({message:"An admin must remove a persistent hazard."},{status:403});const {data,error}=await client.rpc("vote_hazard",{p_id:input.id,p_voter:voter,p_value:input.action==="confirm"?1:-1});if(error)throw error;result=data;}
  }
  const response=NextResponse.json({hazard:publicHazard(result)});response.cookies.set("wayfinder-reporter",visitor,{httpOnly:true,sameSite:"strict",secure:request.nextUrl.protocol==="https:",maxAge:86400,path:"/"});return response;
 }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return NextResponse.json({message:"Invalid hazard report"},{status:400});return NextResponse.json({message:"Unable to sync report. It remains on this device until shared hazards reconnect."},{status:503});}
}
