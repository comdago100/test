import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { getProgress, steps } from "../lib/workflow.js";

let db;
const sqlFile = name => readFile(new URL("../supabase/" + name, import.meta.url), "utf8");
const counts = quantities => Object.fromEntries(steps.map((step, i) => [step.name, quantities[i]]));
async function current(id) {
  return (await db.query("select * from public.work_orders where wo_id=$1", [id])).rows[0];
}
async function fresh(target = 100) {
  const id = randomUUID();
  await db.query("insert into public.work_orders(wo_id,client_code,item_code,target_qty,current_step) values($1,'C','I',$2,'발행대기')", [id, target]);
  return id;
}
async function record(id, step, qty, request = randomUUID(), note = "") {
  return (await db.query("select public.record_production_progress($1,$2,$3,$4,$5) as result", [id, step, qty, request, note])).rows[0].result;
}
async function reverse(event, request = randomUUID()) {
  return (await db.query("select public.reverse_production_progress($1,$2) as result", [event, request])).rows[0].result;
}
async function opening(id, quantities, request = randomUUID()) {
  return (await db.query("select public.initialize_production_quantities($1,$2,$3) as result", [id, JSON.stringify(counts(quantities)), request])).rows[0].result;
}
async function eventCount(id) {
  return Number((await db.query("select count(*) as n from public.production_events where wo_id=$1", [id])).rows[0].n);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.clients(client_code text primary key, client_name text, contact_info text);
    create table public.items(item_code text primary key, item_name text, unit_weight numeric);
    create table public.raw_materials(raw_code text primary key, raw_name text, unit text);
    create table public.work_orders(
      wo_id text primary key, client_code text, item_code text, target_qty numeric,
      current_step text, created_at timestamptz default now()
    );
    create table public.material_usage(
      usage_id bigint generated always as identity primary key,
      wo_id text references public.work_orders(wo_id), raw_code text, input_qty numeric
    );
    insert into public.clients values('C','Client','');
    insert into public.items values('I','Item',0);
  `);
  await db.exec(await sqlFile("production_management.sql"));
  await db.exec(await sqlFile("anonymous_management.sql"));
  await db.exec(`
    insert into public.work_orders(wo_id,target_qty,current_step,actual_qty) values
      ('old-waiting',100,'발행대기',null), ('old-progress',100,'가공완료',50),
      ('old-shipped',100,'출고완료',100), ('old-zero',100,'주입완료',null);
  `);
  await db.exec(await sqlFile("partial_production.sql"));
  await db.exec(await sqlFile("client_management.sql"));
  await db.exec(await sqlFile("routing_management.sql"));
});
after(async () => { await db?.close(); });

async function saveClient(client,create=true,expected=null) {
  return (await db.query("select public.save_production_client($1,$2,$3) as result",
    [JSON.stringify({client_type:"customer",is_active:true,...client}),create,expected])).rows[0].result;
}
test("client profiles create and update all business fields without losing legacy contacts",async()=>{
  const fields={client_code:"PROFILE",client_name:"거래처",client_type:"both",business_number:"123-45-67890",
    representative:"대표",business_type:"제조업",business_item:"주조",contact_name:"담당자",phone:"02-1234-5678",
    contact_phone:"010-1234-5678",fax:"02-1234-5679",email:"buyer@example.com",tax_email:"tax@example.com",
    postal_code:"00123",address:"사업장 주소",shipping_address:"납품 공장",payment_terms:"월말 마감",
    delivery_notes:"오전 입고",notes:"검사 기준 확인"};
  const created=await saveClient(fields);
  for(const [key,value] of Object.entries({...fields,business_number:"1234567890"})) assert.equal(created[key],value);
  await db.query("update public.clients set contact_info='기존 번호' where client_code='PROFILE'");
  const snapshot=(await db.query("select * from public.clients where client_code='PROFILE'")).rows[0];
  const updated=await saveClient({...fields,client_name:"수정한 거래처"},false,snapshot.client_updated_at.toISOString());
  assert.equal(updated.contact_info,"기존 번호");
  assert.equal(updated.client_name,"수정한 거래처");
  await assert.rejects(saveClient({...fields,client_name:"오래된 수정"},false,created.client_updated_at),/다른 사용자가/);
});
test("invalid client data and duplicate codes do not partially save",async()=>{
  for(const patch of [{business_number:"123"},{postal_code:"1234"},{email:"invalid"},{client_type:"invalid"},
    {is_active:"false"},{phone:"x".repeat(51)},{client_name:""},{client_code:"HAS SPACE"}]) {
    await assert.rejects(saveClient({client_code:"INVALID",client_name:"거래처",...patch}));
  }
  assert.equal((await db.query("select count(*)::integer as n from public.clients where client_code='INVALID'")).rows[0].n,0);
  await saveClient({client_code:"DUP",client_name:"원본"});
  await assert.rejects(saveClient({client_code:"DUP",client_name:"다른 이름"}),/duplicate key/);
  assert.equal((await db.query("select client_name from public.clients where client_code='DUP'")).rows[0].client_name,"원본");
});
test("stopping a client blocks new orders while preserving edits and history of existing orders",async()=>{
  const client=await saveClient({client_code:"STOP",client_name:"일시중지 거래처"});
  await db.query("insert into public.work_orders(wo_id,client_code,item_code,target_qty) values('OLD-STOP','STOP','I',10)");
  await saveClient({...client,is_active:false},false,client.client_updated_at);
  await assert.rejects(db.query("insert into public.work_orders(wo_id,client_code,item_code,target_qty) values('NEW-STOP','STOP','I',10)"),/거래중지/);
  await assert.rejects(db.query("select public.save_production_order($1,'[]',true,'[]')",[JSON.stringify({wo_id:"RPC-STOP",client_code:"STOP",item_code:"I",target_qty:10})]),/거래중지/);
  await db.query("select public.save_production_order($1,'[]',false,'[]')",[JSON.stringify({wo_id:"OLD-STOP",client_code:"STOP",item_code:"I",target_qty:10,notes:"기존 작업 수정"})]);
  assert.equal((await current("OLD-STOP")).notes,"기존 작업 수정");
});
test("client migration is repeatable and the RPC keeps the configured login mode",async()=>{
  const before=(await db.query("select to_jsonb(c) as row from public.clients c where client_code='PROFILE'")).rows[0].row;
  await db.exec(await sqlFile("client_management.sql"));
  assert.deepEqual((await db.query("select to_jsonb(c) as row from public.clients c where client_code='PROFILE'")).rows[0].row,before);
  await db.exec("set role anon");
  try {await saveClient({client_code:"PUBLIC-CLIENT",client_name:"공개 모드 거래처"});}
  finally {await db.exec("reset role");}
  await db.exec("revoke execute on function public.create_production_master(text,text,text) from anon");
  await db.exec("set role anon");
  try {await assert.rejects(saveClient({client_code:"DENIED-CLIENT",client_name:"권한 확인"}),/관리자 권한/);}
  finally {
    await db.exec("reset role");
    await db.exec("grant execute on function public.create_production_master(text,text,text) to anon");
  }
});

test("migration preserves old statuses and requires actual opening counts for progressed orders", async () => {
  assert.equal((await current("old-waiting")).quantity_confirmed, true);
  const old = await current("old-progress");
  assert.equal(old.quantity_confirmed, false);
  assert.equal(old.current_step, "가공완료");
  assert.equal(Number(old.actual_qty), 50);
  assert.equal((await current("old-shipped")).quantity_confirmed, false);
  await assert.rejects(record("old-progress", 0, 1), /누적 완료 수량/);
  assert.equal(await eventCount("old-progress"), 0);
});

test("opening records exact historical totals once and permits safe retries", async () => {
  const request = randomUUID(), totals = [67, 53, 39, 31, 21, 13];
  const first = await opening("old-progress", totals, request);
  assert.deepEqual(first.process_quantities, counts(totals));
  assert.equal(first.current_step, "부분출고");
  assert.equal(Number(first.actual_qty), 31);
  await opening("old-progress", totals, request);
  assert.equal(await eventCount("old-progress"), 6);
  await assert.rejects(opening("old-progress", [68, 53, 39, 31, 21, 13], request), /동일 요청/);
  await assert.rejects(opening("old-progress", totals), /이미 수량 확인/);
});

test("invalid opening counts roll back completely, while explicit zero counts are valid", async () => {
  await assert.rejects(opening("old-zero", [10, 11, 0, 0, 0, 0]), /누적 수량/);
  assert.equal(await eventCount("old-zero"), 0);
  assert.equal((await current("old-zero")).quantity_confirmed, false);
  await assert.rejects(db.query("select public.initialize_production_quantities($1,$2,$3)", ["old-zero", '{"조형":10}', randomUUID()]), /누적 수량/);
  const initialized = await opening("old-zero", [0, 0, 0, 0, 0, 0]);
  assert.equal(initialized.current_step, "발행대기");
  await record("old-zero", 0, 7);
});

test("arbitrary successive batches can ship early and finish only when the whole target ships", async () => {
  const id = await fresh();
  for (const qty of [13, 7, 26, 54]) {
    for (let step = 0; step < 6; step++) await record(id, step, qty);
    const order = await current(id);
    const p = getProgress(order);
    assert.equal(p.shipped, p.completed[0]);
    assert.equal(p.remaining, 100 - p.shipped);
    assert.equal(order.current_step, p.shipped === 100 ? "출고완료" : "부분출고");
  }
  assert.equal(await eventCount(id), 24);
  assert.equal(getProgress(await current(id)).complete, true);
});

test("independent process quantities and available balances are preserved", async () => {
  const id = await fresh(), quantities = [67, 53, 39, 31, 21, 13];
  for (let step = 0; step < 6; step++) await record(id, step, quantities[step]);
  assert.deepEqual(getProgress(await current(id)).available, [33, 14, 14, 8, 10, 8]);
  await assert.rejects(record(id, 5, 9), /초과/);
  assert.equal(await eventCount(id), 6);
  await record(id, 5, 8);
  assert.equal(getProgress(await current(id)).shipped, 21);
});

test("invalid, out-of-order and excess records never change the ledger", async () => {
  const id = await fresh(10);
  for (const [step, qty] of [[1, 1], [5, 1], [0, 11], [0, 0], [0, -1], [6, 1], [-1, 1], [null, 1], [0, null]])
    await assert.rejects(record(id, step, qty));
  assert.equal(await eventCount(id), 0);
  assert.equal((await current(id)).current_step, "발행대기");
});

test("two competing submissions cannot consume more than the available quantity", async () => {
  // PGlite queues connections; this tests server-side revalidation of stale requests.
  const id = await fresh(10);
  const results = await Promise.allSettled([record(id, 0, 7), record(id, 0, 7)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(getProgress(await current(id)).completed[0], 7);
  assert.equal(await eventCount(id), 1);
});

test("the same request can be retried after commit without duplicating quantities", async () => {
  const id = await fresh(10), request = randomUUID();
  await Promise.all([record(id, 0, 7, request, "batch A"), record(id, 0, 7, request, "batch A")]);
  assert.equal(await eventCount(id), 1);
  await assert.rejects(record(id, 0, 3, request, "batch A"), /동일 요청/);
  await assert.rejects(record(id, 0, 7, request, "batch B"), /동일 요청/);
  assert.equal(getProgress(await current(id)).completed[0], 7);
});

test("cancellation preserves history and cannot remove quantities already used downstream", async () => {
  const id = await fresh(10), shape = randomUUID(), pour = randomUUID(), undo = randomUUID();
  await record(id, 0, 7, shape); await record(id, 1, 5, pour);
  await assert.rejects(reverse(shape), /후속 공정/);
  assert.equal(await eventCount(id), 2);
  await reverse(pour, undo); await reverse(pour, undo);
  assert.equal(await eventCount(id), 3);
  await assert.rejects(reverse(pour), /이미 취소/);
  await reverse(shape);
  assert.deepEqual(getProgress(await current(id)).completed, [0, 0, 0, 0, 0, 0]);
  assert.equal(await eventCount(id), 4);
});

test("old clients cannot overwrite statuses, quantities or initialized state", async () => {
  const id = await fresh();
  await record(id, 0, 13);
  await assert.rejects(db.query("update public.work_orders set current_step='출고완료' where wo_id=$1", [id]), /상태만 변경/);
  await db.query("update public.work_orders set process_quantities=$2, actual_qty=999 where wo_id=$1", [id, JSON.stringify(counts([100,100,100,100,100,100]))]);
  assert.equal(getProgress(await current(id)).completed[0], 13);
  assert.equal(Number((await current(id)).actual_qty), 0);
  await assert.rejects(db.query("update public.work_orders set quantity_confirmed=false where wo_id=$1", [id]), /기존 수량 확인/);
});

test("target edits cannot undercut existing quantities; increasing target reopens remaining work", async () => {
  const id = await fresh(10);
  for (let step = 0; step < 6; step++) await record(id, step, 10);
  await assert.rejects(db.query("update public.work_orders set target_qty=9 where wo_id=$1", [id]), /목표 수량/);
  await db.query("update public.work_orders set target_qty=15 where wo_id=$1", [id]);
  assert.equal((await current(id)).current_step, "부분출고");
  assert.deepEqual(getProgress(await current(id)).available, [5, 0, 0, 0, 0, 0]);
  for (const qty of [0, -1, 1.5]) await assert.rejects(fresh(qty), /정수/);
});

test("existing order save/delete RPCs preserve invariants and cascade process history", async () => {
  const id = await fresh(10), shape = randomUUID();
  await record(id, 0, 7, shape);
  await reverse(shape);
  const form = { wo_id: id, client_code: "C", item_code: "I", target_qty: 5, actual_qty: 999 };
  await db.query("select public.save_production_order($1,'[]',false,'[]')", [JSON.stringify(form)]);
  assert.equal(Number((await current(id)).actual_qty), 0);
  await db.query("select public.delete_production_order($1)", [id]);
  assert.equal(await current(id), undefined);
  assert.equal(await eventCount(id), 0);
});

test("public shop-floor clients can use RPCs but cannot write the ledger directly", async () => {
  const id = await fresh(10);
  await db.exec("set role anon");
  try {
    await record(id, 0, 3);
    assert.equal(await eventCount(id), 1);
    await assert.rejects(db.query("insert into public.production_events(wo_id,step,quantity) values($1,0,99)", [id]), /permission denied/);
    await assert.rejects(db.query("update public.production_events set quantity=99 where wo_id=$1", [id]), /permission denied/);
    await assert.rejects(db.query("delete from public.production_events where wo_id=$1", [id]), /permission denied/);
  } finally { await db.exec("reset role"); }
});

test("reapplying the migration keeps all production counts and old confirmations", async () => {
  const before = await current("old-progress"), n = await eventCount("old-progress");
  await db.exec(await sqlFile("partial_production.sql"));
  assert.deepEqual(await current("old-progress"), before);
  assert.equal(await eventCount("old-progress"), n);
  assert.equal((await current("old-shipped")).quantity_confirmed, false);
});

async function routed(code="CAST",target=100) {
  const id=randomUUID();
  const result=await db.query("select public.save_routed_production_order($1,'[]',true,'[]') as result",
    [JSON.stringify({wo_id:id,client_code:"C",item_code:"I",target_qty:target,routing_code:code})]);
  return result.rows[0].result;
}
async function routing(code) {return (await db.query("select * from public.production_routings where routing_code=$1",[code])).rows[0];}
async function saveRoute(route,create=false) {return (await db.query("select public.save_production_routing($1,$2,$3) as result",[JSON.stringify(route),create,create?null:route.revision])).rows[0].result;}

test("casting and purchased goods use independent snapshots and terminal shipment indices",async()=>{
  // The preceding backwards-compatibility test deliberately reinstalled the old guard.
  await db.exec(await sqlFile("routing_management.sql"));
  for(const [code,length] of [["CAST",8],["TRADE",4]]) {
    let row=await routed(code);
    assert.equal(row.routing_steps.length,length);
    for(let i=0;i<length;i++) row=await record(row.wo_id,i,17);
    assert.equal(row.current_step,"부분출고");
    assert.equal(getProgress(row).shipped,17);
    assert.equal(getProgress(row).remaining,83);
    assert.equal(row.actual_qty,17);
    await assert.rejects(record(row.wo_id,length,1),/공정과 처리 수량/);
    await assert.rejects(record(row.wo_id,length-1,1),/초과/);
    for(let i=0;i<length;i++) row=await record(row.wo_id,i,83);
    assert.equal(row.current_step,"출고완료");
    assert.equal(getProgress(row).complete,true);
  }
});
test("editing and reordering routing stages never changes issued orders or ledger indices",async()=>{
  const original=await routing("CAST"), issued=await routed();
  const first=await record(issued.wo_id,0,19);
  const draft={...original,steps:original.steps.map(s=>({...s}))};
  draft.steps[0].name="수정된 조형";
  [draft.steps[2],draft.steps[3]]=[draft.steps[3],draft.steps[2]];
  const saved=await saveRoute(draft);
  const old=await current(issued.wo_id),next=await routed();
  assert.deepEqual(old.routing_steps,issued.routing_steps);
  assert.deepEqual(old.process_quantities,first.process_quantities);
  assert.equal(next.routing_steps[0].name,"수정된 조형");
  assert.equal(next.routing_steps[2].name,"쇼트");
  await assert.rejects(db.query("update public.work_orders set routing_steps=$2 where wo_id=$1",[issued.wo_id,JSON.stringify(next.routing_steps)]),/발행된 작업지시/);
  await assert.rejects(saveRoute(draft),/다른 사용자가/);
  await saveRoute({...original,revision:saved.revision});
});
test("route CRUD validates terminal shipment, duplicates, missing steps and atomic creation",async()=>{
  const source=await routing("TRADE");
  for(const steps of [[],[source.steps[0]], [...source.steps,source.steps[0]],
    [source.steps[0],source.steps[0],source.steps[3]],
    [{...source.steps[0],name:42},source.steps[3]]]) {
    await assert.rejects(saveRoute({...source,routing_code:"INVALID",steps},true));
    assert.equal(await routing("INVALID"),undefined);
  }
  const made=await saveRoute({...source,routing_code:"COPY",routing_name:"매입 복사"},true);
  const deleted=(await db.query("select public.delete_production_routing($1,$2) as result",[made.routing_code,made.revision])).rows[0].result;
  assert.equal(deleted.archived,false);
  assert.equal(await routing("COPY"),undefined);
});
test("deleting a used route archives it and preserves existing work while blocking new orders",async()=>{
  const source=await routing("TRADE");
  const custom=await saveRoute({...source,routing_code:"USED",routing_name:"보관 테스트"},true);
  const issued=await routed("USED");
  const deleted=(await db.query("select public.delete_production_routing($1,$2) as result",["USED",custom.revision])).rows[0].result;
  assert.equal(deleted.archived,true);
  await assert.rejects(routed("USED"),/사용 가능한 라우팅/);
  assert.equal((await record(issued.wo_id,0,9)).process_quantities.receipt,9);
  assert.equal((await current(issued.wo_id)).routing_name,"보관 테스트");
});
test("routing migration repeats without replacing custom definitions, quantities or permission mode",async()=>{
  const issued=await routed("CAST");await record(issued.wo_id,0,11);
  const before=await current(issued.wo_id),used=await routing("USED");
  await db.exec(await sqlFile("routing_management.sql"));
  assert.deepEqual(await current(issued.wo_id),before);
  assert.deepEqual(await routing("USED"),used);
  await db.exec("revoke execute on function public.create_production_master(text,text,text) from anon");
  try {
    await assert.rejects(saveRoute({...await routing("TRADE"),routing_code:"UNAUTHORIZED"},true),/관리자 권한/);
  }finally{await db.exec("grant execute on function public.create_production_master(text,text,text) to anon");}
});
