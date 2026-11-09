import {describe,it,expect} from "vitest";
import {estimateMarkerPose,markerToModel,calibrateFocalFraction} from "../lib/qr/pose";
import {stablePose,plausibleJump,type PoseSample} from "../lib/qr/quality";
import {matchZone} from "../lib/zones";
import type {NavGraph} from "../lib/astar";
describe("QR geometry and gates",()=>{
 it("recovers a frontal 15cm marker 1m away and camera facing the wall",()=>{const p=estimateMarkerPose([[245,165],[395,165],[395,315],[245,315]],150,{fx:1000,fy:1000,cx:320,cy:240});expect(p.camera[2]).toBeCloseTo(1);expect(p.camera[0]).toBeCloseTo(0);expect(p.forward[2]).toBeCloseTo(-1);expect(p.reprojectionRmsPx).toBeLessThan(1e-8);const model=markerToModel(p,{position:[2,1.5,3],normal:[0,1]});expect(model.position[2]).toBeCloseTo(4);expect(model.forward[1]).toBeCloseTo(-1);});
 it("recovers lateral offset rather than snapping to the anchor",()=>{const p=estimateMarkerPose([[145,165],[295,165],[295,315],[145,315]],150,{fx:1000,fy:1000,cx:320,cy:240});expect(p.camera[0]).toBeCloseTo(.1);expect(p.camera[2]).toBeCloseTo(1);});
 it("rejects degenerate corners",()=>expect(()=>estimateMarkerPose([[0,0],[1,0],[2,0],[3,0]],150,{fx:1000,fy:1000,cx:320,cy:240})).toThrow());
 it("calibrates a measured camera focal fraction",()=>expect(calibrateFocalFraction(150,150,1,640)).toBeCloseTo(1000/640));
 const sample=(x:number,yaw=359):PoseSample=>({anchorId:"a",position:[x,0],yaw,timestamp:1000,uncertaintyM:.5});
 it("requires three stable frames and handles yaw wrapping",()=>{expect(stablePose([sample(0),sample(.1)],.3,8)).toBeNull();expect(stablePose([sample(0),sample(.1,1),sample(.2,0)],.3,8)?.position[0]).toBe(.1);expect(stablePose([sample(0),sample(2),sample(.1)],.3,8)).toBeNull();});
 it("rejects physically impossible jumps",()=>{expect(plausibleJump(sample(0),{...sample(20),timestamp:2000},2)).toBe(false);expect(plausibleJump(sample(0),{...sample(1),timestamp:2000},2)).toBe(true);});
 it("matches full tokens on the current floor and prefers longest label",()=>{const g:NavGraph={nodes:{1:[0,0,0],2:[0,0,0],3:[0,0,1]},edges:{},exits:[],zones:{1:{label:"Room 1",type:"room"},2:{label:"Room 12",type:"room"},3:{label:"Room 12",type:"room"}}};expect(matchZone(g,"Room 12",0)?.nodeId).toBe(2);expect(matchZone(g,"Room 123",0)).toBeNull();expect(matchZone(g,"Room 12",1)?.nodeId).toBe(3);});
});
