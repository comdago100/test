import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const quantities = { 조형:67, 주입:53, 가공:39, 검사:31, 포장:21, 출고:13 };
async function backend(page) {
  const first = {wo_id:"0001",client_code:"001",item_code:"001",target_qty:100,quantity_confirmed:true,
    process_quantities:quantities,current_step:"부분출고",unit_weight_kg:2.75,notes:"=SUM(A1:A2)",created_at:"2026-11-01T15:01:00Z"};
  const orders = [first,{...first,wo_id:"0002",client_code:"002",quantity_confirmed:false,current_step:"출고완료"}];
  const clients=[{client_code:"001",client_name:"가나다 주물",contact_info:"010-1234-5678"},{client_code:"002",client_name:"다른 거래처"}];
  const items=[{item_code:"001",item_name:"주물 A",unit_weight:2.75},{item_code:"002",item_name:"주물 B",unit_weight:1.25}];
  const materials=[{raw_code:"001",raw_name:"선철",unit:"kg"},{raw_code:"002",raw_name:"고철",unit:"kg"}];
  const events = Array.from({length:1000},(_,i)=>({event_id:"pair-"+i,wo_id:"0001",step:0,
    quantity:i%2 ? -1 : 1,kind:i%2 ? "reversal":"completion",
    reversal_of:i%2 ? "pair-"+(i-1):null,created_at:"2026-11-01T15:00:00Z"}));
  Object.entries({...quantities,출고:10}).forEach(([name,quantity],step)=>events.push({
    event_id:"opening-"+step,wo_id:"0001",step,quantity,kind:"opening",created_at:"2026-11-01T15:00:00Z"}));
  events.push({event_id:"shipment",wo_id:"0001",step:5,quantity:7,kind:"completion",created_at:"2026-11-01T16:00:00Z"},
    {event_id:"undo",wo_id:"0001",step:5,quantity:-4,kind:"reversal",reversal_of:"shipment",created_at:"2026-11-01T16:01:00Z"});
  const state={queries:[],writes:0,failHistory:false};
  await page.route("**/rest/v1/**", async route => {
    const request=route.request(),url=new URL(request.url()),table=url.pathname.split("/").pop();
    const headers={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,OPTIONS"};
    if(request.method()==="OPTIONS") return route.fulfill({status:200,headers,json:null});
    if(request.method()!=="GET") {state.writes++;return route.abort("blockedbyclient");}
    const start=Number(url.searchParams.get("offset")||request.headers().range?.split("-")[0]||0);
    const limit=Number(url.searchParams.get("limit")||1000);
    let rows={work_orders:orders,clients,items,raw_materials:materials,
      material_usage:[{wo_id:"0001",usage_id:1,raw_code:"001",input_qty:12.25}]}[table]||[];
    if(table==="production_events") {
      state.queries.push({start,url:url.href});
      if(state.failHistory) return route.fulfill({status:403,headers,json:{code:"42501",message:"permission denied"}});
      const ids=(url.searchParams.get("wo_id")||"in.()").slice(4,-1).split(",").map(value=>value.replaceAll('"',""));
      rows=events.filter(row=>ids.includes(row.wo_id));
      for(const condition of url.searchParams.getAll("created_at")) {
        const [operator,...parts]=condition.split(".");
        const time=new Date(parts.join(".")).valueOf();
        rows=rows.filter(row=>operator==="gte" ? new Date(row.created_at).valueOf()>=time
          :operator==="lt" ? new Date(row.created_at).valueOf()<time :new Date(row.created_at).valueOf()<=time);
      }
      rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.event_id.localeCompare(b.event_id));
    }
    return route.fulfill({status:200,headers,json:rows.slice(start,start+limit)});
  });
  return state;
}
async function readDownload(page, testInfo, action, name="report.xlsx") {
  const waiting=page.waitForEvent("download");
  await action();
  const download=await waiting;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path=testInfo.outputPath(name);
  await download.saveAs(path);
  const parsed=spawnSync("python",["-B",fileURLToPath(new URL("../read_xlsx.py",import.meta.url)),path],{encoding:"utf8",maxBuffer:20_000_000});
  expect(parsed.status,parsed.stderr).toBe(0);
  return JSON.parse(parsed.stdout);
}
const rowObject=sheet=>Object.fromEntries(sheet.rows[0].map((key,i)=>[key,sheet.rows[1][i]]));

test("filtered production download contains all history pages, signed shipments and typed cells",async({page},testInfo)=>{
  const state=await backend(page);
  await page.goto("/orders/");
  await page.getByLabel("작업지시 검색",{exact:true}).fill("가나다");
  await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
  await page.getByLabel("실적 시작일 (선택)",{exact:true}).fill("2026-11-02");
  await page.getByLabel("실적 종료일 (선택)",{exact:true}).fill("2026-11-02");
  await page.getByRole("dialog").screenshot({path:testInfo.outputPath("export-options.png")});
  const workbook=await readDownload(page,testInfo,()=>page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click());
  expect(Object.keys(workbook)).toHaveLength(6);
  expect(workbook["작업지시 현황"].rows).toHaveLength(2);
  const order=rowObject(workbook["작업지시 현황"]);
  expect(order["작업지시 번호"]).toBe("0001");
  expect(order["출고 잔량(개)"]).toBe(87);
  expect(order["제품 단중(kg)"]).toBe(2.75);
  expect(order["작업 메모"]).toBe("=SUM(A1:A2)");
  expect(workbook["공정 처리 이력"].rows).toHaveLength(1009);
  const shipments=workbook["출고 이력"],qty=shipments.rows[0].indexOf("처리 수량(개)");
  expect(shipments.rows.slice(1).map(row=>row[qty])).toEqual([7,-4]);
  expect(rowObject(workbook["원재료 투입"])["투입 중량(kg)"]).toBe(12.25);
  expect(state.queries.map(query=>query.start)).toEqual([0,1000]);
  expect(state.queries[0].url).toContain(encodeURIComponent("2026-11-01T15:00:00.000Z"));
  expect(state.writes).toBe(0);
});

test("whole-order scope includes hidden search results and keeps unknown quantities blank",async({page},testInfo)=>{
  const state=await backend(page);
  await page.goto("/");
  await page.getByLabel("작업지시 검색",{exact:true}).fill("검색결과없음");
  await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
  await expect(page.getByRole("button",{name:"엑셀 파일 받기",exact:true})).toBeDisabled();
  await page.getByLabel("대상 범위",{exact:true}).selectOption("all");
  const workbook=await readDownload(page,testInfo,()=>page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click());
  const sheet=workbook["작업지시 현황"],id=sheet.rows[0].indexOf("작업지시 번호"),remaining=sheet.rows[0].indexOf("출고 잔량(개)");
  expect(sheet.rows).toHaveLength(3);
  expect(sheet.rows.find(row=>row[id]==="0002")[remaining]).toBeNull();
  expect(state.writes).toBe(0);
});

test("registry downloads follow the search and include useful master fields",async({page},testInfo)=>{
  const state=await backend(page);
  for(const [path,label,sheetName,column,value] of [
    ["/clients/","거래처","거래처 목록","연락처","010-1234-5678"],
    ["/items/","품목","품목 목록","제품 단중(kg)",2.75],
    ["/materials/","원재료","원재료 목록","단위","kg"],
  ]) {
    await page.goto(path);
    await page.getByLabel(label+" 검색",{exact:true}).fill("001");
    const workbook=await readDownload(page,testInfo,()=>page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click(),label+".xlsx");
    expect(workbook[sheetName].rows).toHaveLength(2);
    expect(workbook[sheetName].rows[1][0]).toBe("001");
    expect(rowObject(workbook[sheetName])[column]).toBe(value);
  }
  expect(state.writes).toBe(0);
});

test("a history failure prevents a silently incomplete workbook",async({page})=>{
  const state=await backend(page);state.failHistory=true;
  let downloads=0;page.on("download",()=>downloads++);
  await page.goto("/orders/");
  await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
  await page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("이력을 불러오지");
  expect(downloads).toBe(0);
  expect(state.writes).toBe(0);
});

test("invalid history date ranges are rejected before reading history",async({page})=>{
  const state=await backend(page);
  await page.goto("/orders/");
  await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
  await page.getByLabel("실적 시작일 (선택)",{exact:true}).fill("2026-11-03");
  await page.getByLabel("실적 종료일 (선택)",{exact:true}).fill("2026-11-02");
  await page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("시작일과 종료일");
  expect(state.queries).toHaveLength(0);
});
