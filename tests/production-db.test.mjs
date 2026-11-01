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
});
after(async () => { await db?.close(); });

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
