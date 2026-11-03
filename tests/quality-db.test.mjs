import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {getProgress} from "../lib/workflow.js";
let db,legacyId,legacyCounts;
const sql=name=>readFile(new URL("../supabase/"+name,import.meta.url),"utf8");
const query=async(text,args=[]) => (await db.query(text,args)).rows;
const current=async id=>(await query("select * from public.work_orders where wo_id=$1",[id]))[0];
const events=async id=>(await query("select * from public.production_quality_events where wo_id=$1",[id]));
async function fresh(target=20,route="LEGACY") {const id=randomUUID();await query("select public.save_routed_production_order($1,'[]',true,'[]')",[JSON.stringify({wo_id:id,client_code:"C",item_code:"I",target_qty:target,routing_code:route})]);return id;}
const record=async(id,step,qty,request=randomUUID())=>(await query("select public.record_production_progress($1,$2,$3,$4) as result",[id,step,qty,request]))[0].result;
const hold=async(id,step,qty,source="available",request=randomUUID(),reason="균열")=>(await query("select public.record_production_defect($1,$2,$3,$4,$5,$6,'메모') as result",[id,step,qty,source,reason,request]))[0].result;
const resolve=async(id,defect,kind,qty,request=randomUUID())=>(await query("select public.resolve_production_defect($1,$2,$3,$4,$5,'처리') as result",[id,defect,kind,qty,request]))[0].result;
const reverse=async(id,event,request=randomUUID())=>(await query("select public.reverse_production_quality($1,$2,$3,'입력 정정') as result",[id,event,request]))[0].result;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table clients(client_code text primary key,client_name text,contact_info text);
 create table items(item_code text primary key,item_name text,unit_weight numeric);
 create table raw_materials(raw_code text primary key,raw_name text,unit text);
 create table work_orders(wo_id text primary key,client_code text,item_code text,target_qty numeric,current_step text,created_at timestamptz default now());
 create table material_usage(usage_id bigint generated always as identity primary key,wo_id text references work_orders,raw_code text,input_qty numeric);
 insert into clients values('C','Client','');insert into items values('I','Item',0);`);
 for(const file of ["production_management.sql","anonymous_management.sql","partial_production.sql","routing_management.sql"])await db.exec(await sql(file));
 legacyId=await fresh();legacyCounts=(await record(legacyId,0,13)).process_quantities;
 await db.exec(await sql("quality_management.sql"));
});
after(async()=>{await db?.close();});
test("quality migration preserves existing counts and has no inferred defects",async()=>{
 const row=await current(legacyId);assert.deepEqual(row.process_quantities,legacyCounts);
 assert.deepEqual(row.quality_quantities,{});assert.equal((await events(legacyId)).length,0);
 assert.equal(getProgress(row).available[0],7);
});
test("held quantities cannot flow downstream; rework returns to the same process without auto-completing it",async()=>{
 const id=await fresh(),defect=randomUUID();await record(id,0,20);
 let row=await hold(id,1,3,"available",defect);
 assert.equal(getProgress(row).available[1],17);
 await assert.rejects(record(id,1,18),/초과/);
 row=await record(id,1,17);assert.equal(getProgress(row).available[2],17);
 row=await resolve(id,defect,"rework",2);assert.equal(row.process_quantities["주입"],17);
 assert.equal(getProgress(row).available[1],2);assert.equal(getProgress(row).heldTotal,1);
 row=await record(id,1,2);row=await resolve(id,defect,"scrap",1);
 assert.equal(getProgress(row).available[0],1);assert.equal(getProgress(row).scrapTotal,1);
 await record(id,0,1);row=await record(id,1,1);
 for(let i=2;i<6;i++)row=await record(id,i,20);
 assert.equal(getProgress(row).complete,true);assert.equal(row.process_quantities["조형"],21);
 assert.equal(getProgress(row).productionAllowance,21);assert.equal(getProgress(row).shipped,20);
});
test("completed goods can be isolated only before the following process has consumed them",async()=>{
 const id=await fresh(),defect=randomUUID();await record(id,0,20);await record(id,1,10);
 await assert.rejects(hold(id,0,11,"completed"),/초과/);
 let row=await hold(id,0,5,"completed",defect);
 assert.equal(row.process_quantities["조형"],15);assert.equal(getProgress(row).held[0],5);
 row=await resolve(id,defect,"cancel",2);assert.equal(row.process_quantities["조형"],17);
 await resolve(id,defect,"rework",3);row=await record(id,0,3);
 assert.equal(row.process_quantities["조형"],20);assert.equal(getProgress(row).heldTotal,0);
});
test("invalid quantities and over-disposition roll back all quality and normal totals",async()=>{
 const id=await fresh(),defect=randomUUID();
 for(const qty of [0,-1,21])await assert.rejects(hold(id,0,qty));
 await assert.rejects(hold(id,0,1,"available",randomUUID(),""));
 assert.equal((await events(id)).length,0);
 await hold(id,0,5,"available",defect);await resolve(id,defect,"scrap",3);
 const before=await current(id),n=(await events(id)).length;
 await assert.rejects(resolve(id,defect,"rework",3),/잔량/);
 assert.deepEqual(await current(id),before);assert.equal((await events(id)).length,n);
 const other=await fresh();await assert.rejects(resolve(other,defect,"scrap",1),/찾을 수 없습니다/);
});
test("quality requests are idempotent across retries and reject reused IDs for different payloads",async()=>{
 const id=await fresh(),defect=randomUUID(),action=randomUUID();
 const first=await hold(id,0,5,"available",defect);await hold(id,0,5,"available",defect);
 assert.equal((await events(id)).length,1);
 await assert.rejects(hold(id,0,4,"available",defect),/동일 요청/);
 await resolve(id,defect,"scrap",2,action);const row=await resolve(id,defect,"scrap",2,action);
 assert.equal(getProgress(row).scrapTotal,2);assert.equal(getProgress(first).heldTotal,5);
 await assert.rejects(resolve(id,defect,"rework",2,action),/동일 요청/);
});
test("scrap reversal restores hold and cannot undo replacement quantities already produced",async()=>{
 const id=await fresh(),defect=randomUUID(),action=randomUUID(),undo=randomUUID();
 await record(id,0,20);await hold(id,1,3,"available",defect);await resolve(id,defect,"scrap",3,action);
 let row=await reverse(id,action,undo);assert.equal(getProgress(row).heldTotal,3);assert.equal(getProgress(row).scrapTotal,0);
 await reverse(id,action,undo);assert.equal((await events(id)).length,3);
 const again=randomUUID();await resolve(id,defect,"scrap",3,again);await record(id,0,3);
 const before=await current(id);await assert.rejects(reverse(id,again),/초과/);assert.deepEqual(await current(id),before);
});
test("rework reversal is blocked after its returned quantity has already been consumed",async()=>{
 const id=await fresh(),defect=randomUUID(),action=randomUUID();
 await hold(id,0,3,"available",defect);await record(id,0,17);await resolve(id,defect,"rework",3,action);await record(id,0,3);
 await assert.rejects(reverse(id,action),/초과/);assert.equal(getProgress(await current(id)).heldTotal,0);
});
test("outgoing holds never auto-ship and already shipped quantities cannot become factory defects",async()=>{
 const id=await fresh(20,"TRADE"),defect=randomUUID();for(let i=0;i<3;i++)await record(id,i,20);
 let row=await hold(id,3,4,"available",defect);assert.equal(getProgress(row).available[3],16);
 row=await resolve(id,defect,"rework",4);assert.equal(getProgress(row).shipped,0);
 row=await record(id,3,20);assert.equal(getProgress(row).complete,true);
 await assert.rejects(hold(id,3,1,"completed"),/이미 출고/);
});
test("concurrent dispositions cannot consume a held batch twice",async()=>{
 const id=await fresh(),defect=randomUUID();await hold(id,0,5,"available",defect);
 const results=await Promise.allSettled([resolve(id,defect,"rework",4),resolve(id,defect,"scrap",4)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(getProgress(await current(id)).heldTotal,1);
});
test("public scanner uses quality RPCs without direct ledger write permission and cannot forge cached totals",async()=>{
 const id=await fresh(),defect=randomUUID();
 await db.exec("set role anon");
 try {await hold(id,0,2,"available",defect);await assert.rejects(query("delete from public.production_quality_events where wo_id=$1",[id]),/permission denied/);
  await assert.rejects(query("select public.apply_production_quality_event('{}')"),/permission denied/);
 }finally{await db.exec("reset role");}
 await query("update work_orders set quality_quantities='{}',held_qty=0,scrap_qty=999 where wo_id=$1",[id]);
 const before=await current(id);assert.equal(getProgress(before).heldTotal,2);assert.equal(Number(before.scrap_qty),0);
 await db.exec(await sql("quality_management.sql"));assert.deepEqual(await current(id),before);
});
