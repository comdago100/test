import test from "node:test";
import assert from "node:assert/strict";
import {qualityCases,qualityStatus,qualityAdjustment} from "../lib/quality-utils.js";
import {buildProductionSheets} from "../lib/production-export.js";
import {fetchQualityEvents} from "../lib/production-export-data.js";
test("immutable corrections reconcile normal completion events with qualified good quantities",()=>{
 const data=[{event_id:"H",wo_id:"W",step:0,kind:"hold_completed",quantity:5,reason:"균열",created_at:"2020-01-01T00:00:00Z"},
  {event_id:"C",defect_id:"H",wo_id:"W",step:0,kind:"cancel",quantity:2,created_at:"2020-01-02T00:00:00Z"},
  {event_id:"U",defect_id:"H",wo_id:"W",step:0,kind:"reversal",reversal_of:"C",quantity:-2,created_at:"2020-01-02T01:00:00Z"},
  {event_id:"R",defect_id:"H",wo_id:"W",step:0,kind:"rework",quantity:1,created_at:"2020-01-02T02:00:00Z"},
  {event_id:"S",defect_id:"H",wo_id:"W",step:0,kind:"scrap",quantity:1,created_at:"2020-01-02T03:00:00Z"}];
 const byId=new Map(data.map(e=>[e.event_id,e])),[row]=qualityCases(data);
 assert.equal(row.held_qty,3);assert.equal(row.reworked_qty,1);assert.equal(row.scrapped_qty,1);assert.equal(row.cancelled_qty,0);
 assert.equal(qualityStatus(row),"보류 중");
 assert.deepEqual(data.map(e=>qualityAdjustment(e,byId)),[-5,2,-2,0,0]);
 const sheets=buildProductionSheets({orders:[{wo_id:"W",target_qty:20,quantity_confirmed:true,process_quantities:{조형:15},quality_quantities:{조형:{held:3,scrapped:1}}}],qualityEvents:data},
  {start:"2020-01-02",end:"2020-01-02",generatedAt:new Date("2020-01-03T00:00:00Z")});
 const cases=sheets.find(s=>s.name==="불량 현황"),history=sheets.find(s=>s.name==="불량 처리 이력");
 assert.equal(cases.rows.length,1);assert.equal(history.rows.length,4);
 const q=history.columns.findIndex(c=>c.title==="양품 조정(개)");assert.deepEqual(history.rows.map(r=>r[q]),[2,-2,0,0]);
});
test("quality export reads more than 1000 events and retains roots before the requested period",async()=>{
 const calls=[],rows=Array.from({length:1003},(_,i)=>({event_id:String(i)}));
 const client={from(table){assert.equal(table,"production_quality_events");const state={table};
  const q={select(){return q;},in(key,ids){state.ids=ids;return q;},lte(key,value){state.asOf=value;return q;},order(){return q;},range(start,end){calls.push({...state,start,end});return Promise.resolve({data:rows.slice(start,end+1),error:null});}};return q;}};
 const got=await fetchQualityEvents(client,["W","W"],{start:"2020-01-02",end:"2020-01-02",generatedAt:new Date("2020-01-03T00:00:00Z")});
 assert.equal(got.length,1003);assert.deepEqual(calls.map(c=>c.start),[0,1000]);assert.deepEqual(calls[0].ids,["W"]);
});
