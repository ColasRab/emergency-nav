import {shouldInterrupt,type Announcement,type Priority} from "./scheduler";
export type SpeakerOptions={muted:boolean;volume:number;rate:number;language:string;voiceURI:string};
export class Speaker{
 private queue:Announcement[]=[];private current:Announcement|null=null;private lastText=new Map<string,number>();private epoch=0;
 options:SpeakerOptions={muted:false,volume:1,rate:1,language:"en-US",voiceURI:""};
 constructor(private caption:(text:string,priority:Priority)=>void,private cooldownMs=8000){}
 unlock(){if(typeof speechSynthesis==="undefined")return;const u=new SpeechSynthesisUtterance(" ");u.volume=0;speechSynthesis.speak(u);}
 configure(options:Partial<SpeakerOptions>){this.options={...this.options,...options};if(options.muted)this.cancel();}
 speak(announcement:Announcement,force=false):boolean{
  const now=Date.now();if(announcement.expiresAt<now||(!force&&now-(this.lastText.get(announcement.text)??-Infinity)<this.cooldownMs))return false;
  if(this.current&&shouldInterrupt(announcement.priority,this.current.priority))this.cancel();
  if(announcement.priority==="info"&&this.current)return false;
  this.queue=this.queue.filter(a=>a.expiresAt>now&&a.id!==announcement.id);
  this.queue.push(announcement);this.queue.sort((a,b)=>({info:0,maneuver:1,emergency:2}[b.priority]-{info:0,maneuver:1,emergency:2}[a.priority]));this.queue=this.queue.slice(0,2);this.pump();return true;
 }
 cancel(){this.epoch++;if(typeof speechSynthesis!=="undefined")speechSynthesis.cancel();this.current=null;this.queue=[];}
 private pump(){
  if(this.current)return;const a=this.queue.shift();if(!a)return;if(a.expiresAt<Date.now()){this.pump();return;}
  this.lastText.set(a.text,Date.now());this.caption(a.text,a.priority);
  if(this.options.muted||typeof speechSynthesis==="undefined"){this.pump();return;}
  this.current=a;const epoch=this.epoch,u=new SpeechSynthesisUtterance(a.text);u.lang=this.options.language;u.volume=this.options.volume;u.rate=this.options.rate;u.voice=speechSynthesis.getVoices().find(v=>v.voiceURI===this.options.voiceURI)??speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith(this.options.language.slice(0,2)))??null;
  const finish=()=>{if(epoch!==this.epoch)return;this.current=null;this.pump();};u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);
 }
}
