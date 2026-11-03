import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {qualityCases} from "../../lib/quality-utils.js";

const names=["조형","주입","가공","검사","포장","출고"];
async function backend(page){
 const state={base:[20,0,0,0,0,0],quality:[],events:[],calls:[],requests:new Map(),loseResponse:false,failQuality:false,
  order:{wo_id:"WO-QUALITY",client_code:"C",item_code:"I",target_qty:20,current_step:"조형완료",quantity_confirmed:true,quality_quantities:{}}};
 function refresh(){
  const cases=qualityCases(state.quality),held=names.map((_,i)=>cases.filter(d=>d.step===i).reduce((s,d)=>s+d.held_qty,0)),scrap=names.map((_,i)=>cases.filter(d=>d.step===i).reduce((s,d)=>s+d.scrapped_qty,0));
  if(cases.some(d=>d.held_qty<0||d.scrapped_qty<0||d.reworked_qty<0||d.cancelled_qty<0))throw Error("보류 잔량을 초과합니다");
  const done=names.map((_,i)=>state.base[i]-cases.filter(d=>d.step===i&&d.source==="completed").reduce((s,d)=>s+Number(d.quantity)-d.cancelled_qty,0));
  let prev=20+scrap.reduce((s,q)=>s+q,0);
  for(let i=0;i<6;i++){if(done[i]<0||done[i]+held[i]+scrap[i]>prev)throw Error("앞 공정 수량을 초과합니다");prev=done[i];}
  state.order.process_quantities=Object.fromEntries(names.map((n,i)=>[n,done[i]]));
  state.order.quality_quantities=Object.fromEntries(names.map((n,i)=>[n,{held:held[i],scrapped:scrap[i]}]));
  state.order.held_qty=held.reduce((s,q)=>s+q,0);state.order.scrap_qty=scrap.reduce((s,q)=>s+q,0);
 }
 state.refresh=refresh;refresh();
 await page.route("**/rest/v1/**",async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split("/").pop();
  const headers={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,OPTIONS"};
  const ok=json=>route.fulfill({status:200,headers,json});
  if(req.method()==="OPTIONS")return ok(null);
  if(req.method()==="GET"){
   if(table==="work_orders")return ok(url.searchParams.has("wo_id")?state.order:[state.order]);
   if(table==="production_quality_events"&&state.failQuality)return route.fulfill({status:403,headers,json:{code:"42501",message:"quality read denied"}});
   let rows={production_defects:qualityCases(state.quality),production_quality_events:state.quality,production_events:state.events,
    clients:[{client_code:"C",client_name:"Quality Client"}],items:[{item_code:"I",item_name:"품목"}],raw_materials:[],material_usage:[]}[table]||[];
   rows=[...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.event_id||a.defect_id).localeCompare(String(b.event_id||b.defect_id)));
   if((url.searchParams.get("order")||"").includes("desc"))rows.reverse();
   for(const cond of url.searchParams.getAll("created_at")){const [op,...parts]=cond.split(".");const value=new Date(parts.join(".")).valueOf();rows=rows.filter(e=>op==="lte"?new Date(e.created_at).valueOf()<=value:true);}
   const start=Number(url.searchParams.get("offset")||0),limit=Number(url.searchParams.get("limit")||1000);
   return ok(rows.slice(start,start+limit));
  }
  const args=req.postDataJSON();state.calls.push({rpc:table,args});
  if(!state.requests.has(args.p_request_id)){
   const base=[...state.base],quality=[...state.quality],normal=[...state.events];
   try{
    if(table==="record_production_progress"){
     state.base[args.p_step]+=args.p_quantity;state.events.push({event_id:args.p_request_id,wo_id:state.order.wo_id,step:args.p_step,quantity:args.p_quantity,kind:"completion",created_at:new Date().toISOString()});
    }else{
     let event={event_id:args.p_request_id,wo_id:state.order.wo_id,step:args.p_step,quantity:args.p_quantity,reason:args.p_reason||"",note:args.p_note||"",created_at:new Date().toISOString()};
     if(table==="record_production_defect")event.kind=args.p_source==="completed"?"hold_completed":"hold_available";
     if(table==="resolve_production_defect"){const root=state.quality.find(e=>e.event_id===args.p_defect_id);event={...event,step:root.step,defect_id:root.event_id,kind:args.p_kind};}
     if(table==="reverse_production_quality"){const source=state.quality.find(e=>e.event_id===args.p_event_id);event={...event,step:source.step,defect_id:source.defect_id,kind:"reversal",quantity:-source.quantity,reversal_of:source.event_id};}
     state.quality.push(event);
    }
    refresh();state.requests.set(args.p_request_id,args);
   }catch(e){state.base=base;state.quality=quality;state.events=normal;refresh();return route.fulfill({status:400,headers,json:{code:"P0001",message:e.message}});}
  }
  if(state.loseResponse){state.loseResponse=false;return route.abort("failed");}
  return ok(state.order);
 });
 return state;
}
async function lookup(page){await page.goto("/scanner/?wo_id=WO-QUALITY");await expect(page.getByRole("heading",{name:"WO-QUALITY",exact:true})).toBeVisible();}
const station=(page,name)=>page.locator(".station").filter({has:page.getByText(name,{exact:true})});
async function report(page,qty,source="available"){
 const panel=page.locator(".quality-panel");await panel.locator(".quality-register summary").click();
 await panel.getByLabel("불량 수량 기준",{exact:true}).selectOption(source);
 await panel.getByLabel("불량 수량 (개)",{exact:true}).fill(String(qty));
 await panel.getByLabel("불량 사유",{exact:true}).fill("균열");
 await panel.getByRole("button",{name:"불량 보류 등록",exact:true}).click();
 await expect(page.locator(".scan-result.success")).toContainText("보류했습니다");
}
async function dispose(page,kind,qty){
 const panel=page.locator(".quality-panel");await panel.getByRole("button",{name:"이 불량 처리",exact:true}).click();
 await panel.getByLabel("불량 처리 방법",{exact:true}).selectOption(kind);
 await panel.getByLabel("불량 처리 수량 (개)",{exact:true}).fill(String(qty));
 await panel.getByRole("button",{name:"불량 처리 저장",exact:true}).click();
 await expect(panel.locator(".quality-resolution")).toHaveCount(0);
}
test("hold, rework and scrap change available quantities and allow only replacement production",async({page},testInfo)=>{
 const state=await backend(page);await lookup(page);await station(page,"주입").click();
 await report(page,3);
 await expect(page.getByLabel("이번 처리 수량 (개)",{exact:true})).toHaveAttribute("max","17");
 expect(state.calls[0].args.p_source).toBe("available");
 await page.getByLabel("이번 처리 수량 (개)",{exact:true}).fill("17");await page.getByRole("button",{name:"주입 수량 기록",exact:true}).click();
 await expect(page.locator(".scan-result.success")).toContainText("주입 17개");
 await dispose(page,"rework",2);
 await expect(page.getByLabel("이번 처리 수량 (개)",{exact:true})).toHaveAttribute("max","2");
 expect(state.order.process_quantities["주입"]).toBe(17);
 await dispose(page,"scrap",1);
 await expect(page.locator(".quality-panel .quality-summary")).toContainText("확정 폐기 1개");
 await station(page,"조형").click();await expect(page.getByLabel("이번 처리 수량 (개)",{exact:true})).toHaveAttribute("max","1");
 await page.locator(".quality-panel").screenshot({path:testInfo.outputPath("quality-disposition.png")});
 await page.goto("/");await page.getByRole("button",{name:"폐기 발생",exact:true}).click();await expect(page.locator(".order")).toHaveCount(1);
 await expect(page.locator(".order .quality-summary")).toContainText("확정 폐기 1개");
});
test("already completed goods can be isolated and an erroneous hold can be cancelled",async({page})=>{
 const state=await backend(page);await lookup(page);await report(page,5,"completed");
 expect(state.order.process_quantities["조형"]).toBe(15);
 await station(page,"주입").click();await expect(page.getByLabel("이번 처리 수량 (개)",{exact:true})).toHaveAttribute("max","15");
 page.on("dialog",d=>d.accept());await dispose(page,"cancel",2);
 expect(state.order.process_quantities["조형"]).toBe(17);
 await expect(page.locator(".quality-panel .quality-summary")).toContainText("불량 보류 3개");
});
test("a lost defect response retries the identical request after reload without duplicate holds",async({page})=>{
 const state=await backend(page);await lookup(page);await station(page,"주입").click();state.loseResponse=true;
 const panel=page.locator(".quality-panel");await panel.locator(".quality-register summary").click();
 await panel.getByLabel("불량 수량 (개)",{exact:true}).fill("3");await panel.getByLabel("불량 사유",{exact:true}).fill("균열");
 await panel.getByRole("button",{name:"불량 보류 등록",exact:true}).click();
 await expect(page.getByRole("button",{name:"같은 기록 확인 / 재시도",exact:true})).toBeVisible();
 const id=state.calls[0].args.p_request_id;page.on("dialog",d=>d.accept());await page.reload();
 await page.getByRole("button",{name:"같은 기록 확인 / 재시도",exact:true}).click();
 await expect(page.locator(".quality-panel .quality-summary")).toContainText("불량 보류 3개");
 expect(state.quality).toHaveLength(1);expect(state.calls.at(-1).args.p_request_id).toBe(id);
});
test("quality disposition reversal is retained in history and restores the held balance",async({page})=>{
 const state=await backend(page);await lookup(page);await station(page,"주입").click();await report(page,5);await dispose(page,"scrap",3);
 const panel=page.locator(".quality-panel");await panel.locator(".quality-history summary").click();page.on("dialog",d=>d.accept());
 await panel.getByRole("button",{name:"불량 처리 취소",exact:true}).click();
 await expect(panel.locator(".quality-summary")).toContainText("불량 보류 5개");
 await expect(panel.getByRole("button",{name:"불량 처리 취소",exact:true})).toHaveCount(0);
 expect(state.quality.map(e=>e.quantity)).toEqual([5,3,-3]);
});
test("quality workbook includes historical roots and signed in-period actions without treating rework as shipment",async({page},testInfo)=>{
 const state=await backend(page),root=randomUUID(),scrap=randomUUID();
 state.quality=[{event_id:root,wo_id:state.order.wo_id,step:1,kind:"hold_available",quantity:5,reason:"균열",note:"=SUM(A1:A2)",created_at:"2020-01-01T00:00:00Z"},
  {event_id:randomUUID(),wo_id:state.order.wo_id,step:1,kind:"rework",quantity:2,defect_id:root,created_at:"2020-01-02T01:00:00Z"},
  {event_id:scrap,wo_id:state.order.wo_id,step:1,kind:"scrap",quantity:1,defect_id:root,created_at:"2020-01-02T02:00:00Z"},
  {event_id:randomUUID(),wo_id:state.order.wo_id,step:1,kind:"reversal",quantity:-1,defect_id:root,reversal_of:scrap,created_at:"2020-01-02T03:00:00Z"}];state.refresh();
 await page.goto("/orders/");await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
 await page.getByLabel("실적 시작일 (선택)",{exact:true}).fill("2020-01-02");await page.getByLabel("실적 종료일 (선택)",{exact:true}).fill("2020-01-02");
 const waiting=page.waitForEvent("download");await page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click();
 const download=await waiting,file=testInfo.outputPath("quality.xlsx");await download.saveAs(file);
 const read=spawnSync("python",["-B",fileURLToPath(new URL("../read_xlsx.py",import.meta.url)),file],{encoding:"utf8"});expect(read.status,read.stderr).toBe(0);
 const book=JSON.parse(read.stdout);expect(Object.keys(book)).toHaveLength(8);
 const cases=book["불량 현황"].rows,row=Object.fromEntries(cases[0].map((h,i)=>[h,cases[1][i]]));
 expect(row["발생 수량(개)"]).toBe(5);expect(row["보류 수량(개)"]).toBe(3);expect(row["폐기 수량(개)"]).toBe(0);expect(row["메모"]).toBe("=SUM(A1:A2)");
 const history=book["불량 처리 이력"].rows;expect(history).toHaveLength(4);
 expect(history.slice(1).map(r=>r[history[0].indexOf("처리 수량(개)")])).toEqual([2,1,-1]);
 expect(book["출고 이력"].rows).toHaveLength(1);
});
test("a quality read failure prevents a partial workbook",async({page})=>{
 const state=await backend(page);state.failQuality=true;let downloads=0;page.on("download",()=>downloads++);
 await page.goto("/");await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();await page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click();
 await expect(page.getByRole("dialog").getByRole("alert")).toContainText("불량 이력을 불러오지 못했습니다");expect(downloads).toBe(0);
});
