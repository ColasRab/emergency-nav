import {describe,it,expect} from "vitest";
import {applySimilarity,invertSimilarity,fitSimilarity,fitGeoreference,modelToLngLatAlt,lngLatAltToModel,normalizeSignedDegrees,graphToModel,modelToGraph} from "../lib/geo/transform";
import {buildingSchema} from "../lib/buildings";
import raw from "../public/models/ynares.json";
describe("survey transforms",()=>{
  it("round trips scale, rotation and translation",()=>{const t={dx:30,dz:-5,rotationDeg:137,scale:2.4};const p:[number,number]=[4,-9];const q=invertSimilarity(applySimilarity(p,t),t);expect(q[0]).toBeCloseTo(p[0]);expect(q[1]).toBeCloseTo(p[1]);});
  it("fits a proper similarity with zero residual",()=>{const t={dx:-4,dz:21,rotationDeg:37,scale:.4};const points:[number,number][]=[[0,0],[10,0],[0,10],[6,5]];const fit=fitSimilarity(points.map(source=>({source,target:applySimilarity(source,t)})));expect(fit.scale).toBeCloseTo(t.scale);expect(fit.rotationDeg).toBeCloseTo(37);expect(fit.rms).toBeLessThan(1e-9);});
  it("rejects collinear GCPs",()=>expect(()=>fitSimilarity([0,1,2].map(x=>({source:[x,0],target:[x,0]})))).toThrow(/non-collinear/));
  it("round trips georeference and graph floor elevation",()=>{const c=buildingSchema.parse(raw);c.georef={originLngLat:[121,14],altitudeM:30,rotationDeg:18,scale:1,residualRmsM:0};c.graphToModel={dx:3,dz:7,rotationDeg:-25,scale:2};const p:[number,number,number]=[4,3,-6];const q=lngLatAltToModel(modelToLngLatAlt(p,c),c);q.forEach((v,i)=>expect(v).toBeCloseTo(p[i],6));const g:[number,number,number]=[3,4,1];expect(modelToGraph(graphToModel(g,c),1,c)).toEqual(expect.arrayContaining([expect.closeTo(3),expect.closeTo(4),1]));});
  it("fits GCP origin and normalizes all negative bearings",()=>{const fit=fitGeoreference([{model:[0,0],lngLat:[121,14]},{model:[-10,0],lngLat:[121.0000926,14]},{model:[0,10],lngLat:[121,14.00008983]}],20);expect(fit.residualRmsM).toBeLessThan(.01);expect(normalizeSignedDegrees(-901)).toBe(179);});
});

