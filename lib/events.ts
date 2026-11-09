/** Bounded, local tuning log. No images, GPS fixes, account IDs or free text. */
export type TuningEvent={event:"qr_accepted"|"qr_rejected"|"anchor_disagreement"|"reroute"|"hazard_confirmed";buildingId:string;at:number;anchorId?:string;errorM?:number;confidence?:number;floor?:number};
export function logEvent(event:Omit<TuningEvent,"at">){try{const key="wayfinder:tuning:v1",saved=JSON.parse(localStorage.getItem(key)??"[]") as TuningEvent[];localStorage.setItem(key,JSON.stringify([...saved.slice(-249),{...event,at:Date.now()}]));}catch{/* Storage may be unavailable in private browsing. */}}
