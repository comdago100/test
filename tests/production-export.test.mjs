import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildProductionSheets, buildMasterSheets, historyBounds, exportFilename } from "../lib/production-export.js";
import { workbookBlob } from "../lib/excel-download.js";
import { fetchProductionEvents } from "../lib/production-export-data.js";

const known = { wo_id: "0001", client_code: "C001", item_code: "I001", target_qty: 100,
  quantity_confirmed: true, current_step: "부분출고", due_date: "2026-10-01",
  created_at: "2026-10-01T15:01:00Z", unit_weight_kg: "2.75",
  process_quantities: { 조형:67, 주입:53, 가공:39, 검사:31, 포장:21, 출고:13 }, notes: "=SUM(A1:A2)" };
const unknown = { ...known, wo_id: "0002", quantity_confirmed: false, current_step: "출고완료" };
const event = (id, step, quantity, kind = "completion", created_at = "2026-11-01T15:00:00Z") =>
  ({event_id:id, wo_id:"0001", step, quantity, kind, created_at, reversal_of:kind === "reversal" ? "shipment" : null});
const source = {
  orders:[known,unknown], clients:[{client_code:"C001",client_name:"가나다 주물"}],
  items:[{item_code:"I001",item_name:"주물 A"}], materials:[{raw_code:"R001",raw_name:"선철"}],
  usage:[{wo_id:"0001",usage_id:1,raw_code:"R001",input_qty:"12.25"},{wo_id:"OTHER",input_qty:99}],
  events:[event("opening",5,10,"opening"),event("shipment",5,7),event("undo",5,-4,"reversal"),
    event("shape",0,13),{...event("other",5,99),wo_id:"OTHER"}],
};
const options = { generatedAt:new Date("2026-11-02T12:00:00Z"), start:"2026-11-02", end:"2026-11-02" };
function records(sheet) {
  return sheet.rows.map(row => Object.fromEntries(sheet.columns.map((column,i)=>[column.title,row[i]])));
}

test("manufacturing report contains quantities, signed shipment history and material kg for selected orders", () => {
  const sheets = buildProductionSheets(source,options);
  assert.deepEqual(sheets.map(sheet=>sheet.name),["조회조건","작업지시 현황","공정별 수량","공정 처리 이력","출고 이력","원재료 투입"]);
  const orders=records(sheets[1]);
  assert.equal(orders[0]["출고 잔량(개)"],87);
  assert.equal(orders[0]["납기 상태"],"납기 지연");
  assert.equal(orders[1]["출고 잔량(개)"],null);
  assert.equal(orders[1]["출고 누적 완료(개)"],null);
  assert.equal(orders[1]["수량 확인"],"수량 확인 필요");
  assert.deepEqual(records(sheets[2]).slice(0,6).map(row=>row["현재 처리 가능(개)"]),[33,14,14,8,10,8]);
  assert.equal(sheets[3].rows.length,4);
  assert.deepEqual(records(sheets[4]).map(row=>row["처리 수량(개)"]),[7,-4]);
  assert.equal(records(sheets[5])[0]["투입 중량(kg)"],12.25);
  assert.equal(sheets[5].rows.length,1);
});

test("mixed routes keep Excel quantity columns aligned and use each shipment stage",()=>{
  const purchased={...known,wo_id:"TRADE",routing_name:"매입",routing_steps:[
    {key:"in",name:"매입 입고",role:"production"},{key:"out",name:"납품",role:"shipment"}],
    process_quantities:{in:48,out:17}};
  const sheets=buildProductionSheets({...source,orders:[known,purchased],events:[
    event("legacy-shipping",5,7),{...event("trade-shipping",1,17),wo_id:"TRADE"}]},options);
  const rows=records(sheets[1]);
  assert.equal(rows[0]["조형 누적 완료(개)"],67);
  assert.equal(rows[0]["매입 입고 누적 완료(개)"],null);
  assert.equal(rows[1]["매입 입고 누적 완료(개)"],48);
  assert.equal(rows[1]["조형 누적 완료(개)"],null);
  assert.equal(rows[1]["납품 누적 완료(개)"],17);
  assert.deepEqual(records(sheets[4]).map(r=>r["공정"]),["출고","납품"]);
});

test("history dates use inclusive Korean calendar days without changing cumulative quantities", () => {
  assert.deepEqual(historyBounds("2026-11-02","2026-11-02"),{
    from:"2026-11-01T15:00:00.000Z",until:"2026-11-02T15:00:00.000Z"});
  for (const range of [["2026-11-03","2026-11-02"],["2026-02-30",""],["bad",""]])
    assert.throws(()=>historyBounds(...range));
  const events=[event("before",5,1,"completion","2026-11-01T14:59:59.999Z"),
    event("first",5,2,"completion","2026-11-01T15:00:00Z"),
    event("last",5,3,"completion","2026-11-02T14:59:59.999Z"),
    event("after",5,4,"completion","2026-11-02T15:00:00Z")];
  const sheets=buildProductionSheets({...source,events},{...options,generatedAt:new Date("2026-11-03T00:00:00Z")});
  assert.deepEqual(records(sheets[4]).map(row=>row["처리 수량(개)"]),[2,3]);
  assert.equal(records(sheets[1])[0]["출고 잔량(개)"],87);
  assert.equal(exportFilename("생산자료",new Date("2026-11-01T15:00:00Z")),"생산자료_20261102_000000.xlsx");
});

test("downloaded XLSX preserves leading zeros, literal formulas, Korean names, numeric kg and dates", async () => {
  const blob=await workbookBlob(buildProductionSheets(source,options));
  const folder=await mkdtemp(join(tmpdir(),"foundry-export-"));
  try {
    const path=join(folder,"report.xlsx");
    await writeFile(path,new Uint8Array(await blob.arrayBuffer()));
    const result=spawnSync("python",["-B",fileURLToPath(new URL("./read_xlsx.py",import.meta.url)),path],{encoding:"utf8",maxBuffer:5_000_000});
    assert.equal(result.status,0,result.stderr);
    const workbook=JSON.parse(result.stdout);
    const sheet=workbook["작업지시 현황"], header=sheet.rows[0], row=sheet.rows[1];
    const get=name=>row[header.indexOf(name)];
    assert.equal(get("작업지시 번호"),"0001");
    assert.equal(get("거래처명"),"가나다 주물");
    assert.equal(get("제품 단중(kg)"),2.75);
    assert.equal(get("발행 일시(KST)"),"2026-10-02 00:01:00");
    assert.equal(get("작업 메모"),"=SUM(A1:A2)");
    assert.equal(sheet.types[1][header.indexOf("작업 메모")],"s");
    assert.equal(sheet.freeze,"B2");
  } finally {
    const target = resolve(folder);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("foundry-export-"))
      throw new Error("Unexpected temporary export directory");
    await rm(target,{recursive:true,force:true});
  }
});

test("master lists include contact information, numeric item weight and material units", () => {
  assert.deepEqual(buildMasterSheets("client",[{client_code:"001",client_name:"회사",contact_info:"010-1234-5678"}])[0].rows[0].slice(0,3),
    ["001","회사","010-1234-5678"]);
  assert.equal(buildMasterSheets("item",[{item_code:"001",item_name:"품목",unit_weight:"1.25"}])[0].rows[0][2],1.25);
  assert.equal(buildMasterSheets("material",[{raw_code:"001",raw_name:"자재",unit:"kg"}])[0].rows[0][2],"kg");
});

function fakeClient(rows, failure = false) {
  const calls=[];
  return {calls,from(table) {
    const call={table};calls.push(call);
    return {
      select(){return this;},in(key,ids){call.ids=ids;return this;},
      lte(key,value){call.asOf=value;return this;},gte(key,value){call.from=value;return this;},
      lt(key,value){call.until=value;return this;},order(){return this;},
      async range(start,end){call.start=start;return failure ? {error:{message:"denied"}} : {data:rows.filter(row=>call.ids.includes(row.wo_id)).slice(start,end+1)};},
    };
  }};
}
test("history export reads beyond 1000 rows, deduplicates IDs, and applies server-side day limits", async () => {
  const client=fakeClient(Array.from({length:1001},(_,i)=>({...event(String(i),5,1)})));
  const rows=await fetchProductionEvents(client,["0001","0001"],options);
  assert.equal(rows.length,1001);
  assert.deepEqual(client.calls.map(call=>call.start),[0,1000]);
  assert.deepEqual(client.calls[0].ids,["0001"]);
  assert.equal(client.calls[0].from,"2026-11-01T15:00:00.000Z");
  assert.equal(client.calls[0].until,"2026-11-02T15:00:00.000Z");
  const failed=fakeClient([],true);
  await assert.rejects(fetchProductionEvents(failed,["0001"],options),/이력을 불러오지/);
  assert.deepEqual(await fetchProductionEvents(client,[],options),[]);
});
