import type {NextInstruction} from "./instructionBuilder";
export type Priority="info"|"maneuver"|"emergency";
export type Announcement={text:string;priority:Priority;expiresAt:number;id:string};
export class InstructionScheduler{
 private fired=new Set<string>();private lastText=new Map<string,number>();private offRouteSince:number|null=null;
 constructor(private cooldownMs=8000){}
 reset(){this.fired.clear();this.lastText.clear();this.offRouteSince=null;}
 trigger(instruction:NextInstruction,text:string,now:number,advanceM=15,immediateM=3):Announcement|null{
  const stage=instruction.kind==="arrival"?"arrive":instruction.distanceM<=immediateM?"now":instruction.distanceM<=advanceM?"ahead":"straight";
  const id=`${instruction.id}:${stage}`;if(this.fired.has(id)||now-(this.lastText.get(text)??-Infinity)<this.cooldownMs)return null;
  this.fired.add(id);this.lastText.set(text,now);return {text,priority:stage==="straight"?"info":"maneuver",expiresAt:now+5000,id};
 }
 offRoute(distanceM:number,now:number,threshold=4,delayMs=3000):boolean{if(distanceM<=threshold){this.offRouteSince=null;return false;}if(this.offRouteSince===null)this.offRouteSince=now;return now-this.offRouteSince>=delayMs;}
}
export function shouldInterrupt(incoming:Priority,current:Priority):boolean{return incoming==="emergency"||(incoming==="maneuver"&&current==="info");}
