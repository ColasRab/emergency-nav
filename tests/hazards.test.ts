import {it,expect} from "vitest";
import {buildingSchema} from "../lib/buildings";
import raw from "../public/models/ynares.json";
import {astar,type NavGraph} from "../lib/astar";
import {hazardCostModifier,routeWithHazards} from "../lib/hazards/routing";
import {DetectionWindow} from "../lib/hazards/detectors";
import type {Hazard} from "../lib/hazards/model";
const c=buildingSchema.parse(raw),g:NavGraph={nodes:{0:[0,0,0],1:[1,0,0],2:[0,1,0],3:[1,1,0],4:[0,0,1],5:[1,0,1]},edges:{0:[[1,1],[2,1]],1:[[3,1]],2:[[3,2]],3:[],4:[[5,1]],5:[]},zones:{},exits:[3]};
const h:Hazard={id:"00000000-0000-4000-8000-000000000001",buildingId:"ynares",floor:0,nodeIds:[1],type:"fire",severity:3,confidence:.9,source:"user",confirmations:1,dismissals:0,createdAt:0,expiresAt:10000};
it("reroutes only the affected floor and building",()=>{const cost=hazardCostModifier(g,[h],c,100);expect(astar(g,0,[3],undefined,cost).path).toEqual([0,2,3]);expect(cost(4,5,1)).toBe(1);expect(hazardCostModifier(g,[{...h,buildingId:"admin"}],c,100)(0,1,0)).toBe(1);});
it("returns a clearly flagged fallback when all routes are blocked",()=>{const result=routeWithHazards(g,0,[{...h,nodeIds:[1,2]}],c,100);expect(result.path).not.toBeNull();expect(result.fallback).toBe(true);expect(result.hazardIds).toEqual([h.id]);});
it("expires hazards by TTL and dismissals and decays soft costs",()=>{expect(hazardCostModifier(g,[h],c,10001)(0,1,0)).toBe(1);expect(hazardCostModifier(g,[{...h,dismissals:3}],c,100)(0,1,0)).toBe(1);const soft={...h,severity:1 as const};expect(hazardCostModifier(g,[soft],c,5000)(0,1,0)).toBeCloseTo(1.5);});
it("does not hard-block a single automatic detection",()=>{expect(Number.isFinite(hazardCostModifier(g,[{...h,source:"auto",confirmations:0}],c,100)(0,1,0))).toBe(true);const window=new DetectionWindow();expect(window.add(.99)).toBe(false);for(let i=0;i<3;i++)expect(window.add(.99)).toBe(false);expect(window.add(.99)).toBe(true);});
it("keeps an existing route when savings are below 15 percent",()=>{const modified:NavGraph={...g,edges:{...g.edges,0:[[1,1],[2,1]],1:[[3,1]],2:[[3,1.2]]}};expect(routeWithHazards(modified,0,[],c,0,[0,2,3]).path).toEqual([0,2,3]);});
it("blocks stair connectors in both directions when either landing is affected",()=>{const graph:NavGraph={...g,edges:{...g.edges,1:[[5,2]],5:[[1,2]]}};const cost=hazardCostModifier(graph,[{...h,floor:1,nodeIds:[5]}],c,100);expect(cost(1,5,0)).toBe(Infinity);expect(cost(5,1,1)).toBe(Infinity);});

