import type {HazardDetector,DetectedHazard} from "./model";
export class CrowdDetector implements HazardDetector{
 id="coco-people";private model:import("@tensorflow-models/coco-ssd").ObjectDetection|null=null;
 constructor(private busy=3,private congested=7){}
 async load(){await import("@tensorflow/tfjs");const coco=await import("@tensorflow-models/coco-ssd");this.model=await coco.load({base:"lite_mobilenet_v2"});}
 async detect(frame:ImageBitmap|HTMLVideoElement):Promise<DetectedHazard[]>{if(!this.model)return [];let input:HTMLVideoElement|HTMLCanvasElement;if("videoWidth"in frame)input=frame;else{const canvas=document.createElement("canvas");canvas.width=frame.width;canvas.height=frame.height;canvas.getContext("2d")?.drawImage(frame,0,0);input=canvas;}const detections=await this.model.detect(input),people=detections.filter(d=>d.class==="person"&&d.score>=.6);return people.length>=this.busy?[{type:"crowd",confidence:Math.min(...people.map(p=>p.score)),personCount:people.length}]:[];}
 dispose(){this.model?.dispose();this.model=null;}
}
/** Adapter for exported TF.js detectors with named [N,4] xyxy pixel boxes,
 * [N] scores and [N] class IDs. Weights must be trained/validated for the
 * site's fire/smoke domain; no COCO labels are relabeled as fire or smoke.
 */
export class FireSmokeDetector implements HazardDetector{
 id="fire-smoke-tfjs";private model:import("@tensorflow/tfjs").GraphModel|null=null;
 constructor(private manifest:{modelUrl:string;inputSize:number;outputs:[string,string,string];classIds:{fire:number;smoke:number}}){}
 async load(){const tf=await import("@tensorflow/tfjs");this.model=await tf.loadGraphModel(this.manifest.modelUrl);}
 async detect(frame:ImageBitmap|HTMLVideoElement):Promise<DetectedHazard[]>{if(!this.model)return [];const tf=await import("@tensorflow/tfjs");const input=tf.tidy(()=>tf.image.resizeBilinear(tf.browser.fromPixels(frame),[this.manifest.inputSize,this.manifest.inputSize]).toFloat().div(255).expandDims(0));let outputs:import("@tensorflow/tfjs").Tensor[]=[];try{const raw=await this.model.executeAsync(input,this.manifest.outputs);outputs=Array.isArray(raw)?raw:[raw];const [boxes,scores,classes]=await Promise.all(outputs.map(t=>t.data()));const result:DetectedHazard[]=[];for(let i=0;i<scores.length;i++){const type=classes[i]===this.manifest.classIds.fire?"fire":classes[i]===this.manifest.classIds.smoke?"smoke":null;if(type)result.push({type,confidence:scores[i],bbox:[boxes[i*4],boxes[i*4+1],boxes[i*4+2],boxes[i*4+3]]});}return result;}finally{input.dispose();outputs.forEach(t=>t.dispose());}}
 dispose(){this.model?.dispose();this.model=null;}
}
export class DetectionWindow{
 private frames:boolean[]=[];
 constructor(private required=5,private window=8,private threshold=.75){}
 add(confidence:number):boolean{this.frames.push(confidence>=this.threshold);this.frames=this.frames.slice(-this.window);return this.frames.length>=this.required&&this.frames.filter(Boolean).length>=this.required;}
}
