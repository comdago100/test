import {test,expect} from "@playwright/test";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const stages=["조형","주입","가공","검사","포장","출고"];
async function backend(page){
 const sales={order_id:"11111111-1111-4111-8111-111111111111",order_no:"SO-001",client_code:"C",item_code:"I",quantity:100,unit_price:null,amount:null,due_date:"2026-12-01",revision:1,allocated_qty:40,unallocated_qty:60,shipped_qty:7,remaining_qty:93,work_order_count:1,unconfirmed_count:0,status:"부분 출하",created_at:"2026-11-03T00:00:00Z"};
 const work={wo_id:"WO-LINKED",order_id:sales.order_id,client_code:"C",item_code:"I",target_qty:40,quantity_confirmed:true,process_quantities:Object.fromEntries(stages.map((s,i)=>[s,i===5?7:20])),current_step:"부분출고",created_at:sales.created_at};
 const state={calls:[],reads:[],failSchema:false,lose:false,stale:false,requests:new Map(),tables:{
  sales_order_progress:[sales],clients:[{client_code:"C",client_name:"매출 회사",client_type:"customer",is_active:true},{client_code:"S",client_name:"매입 회사",client_type:"supplier",is_active:true},{client_code:"B",client_name:"공통 회사",client_type:"both",is_active:true}],
  items:[{item_code:"I",item_name:"주물품"}],raw_materials:[{raw_code:"A",raw_name:"선철",unit:"kg"}],work_orders:[work,{...work,wo_id:"WO-OTHER",order_id:null}],material_usage:[],
  production_routings:[{routing_code:"LEGACY",routing_name:"기존 6공정",is_active:true,steps:stages.map((name,i)=>({key:name,name,role:i===5?"shipment":"production"}))}],
  material_receipts:[{receipt_id:"22222222-2222-4222-8222-222222222222",kind:"purchase",raw_code:"A",client_code:"S",received_on:"2026-11-03",quantity:10.125,unit_price:0,amount:0,revision:1,is_void:false,notes:"=SUM(A1:A2)"}],
  material_inventory:[{raw_code:"A",raw_name:"선철",unit:"kg",purchased_qty:0,opening_qty:0,used_qty:25.125,on_hand:-25.125,stock_revision:"1",opening_confirmed:false}],
  finished_inventory:[{item_code:"I",item_name:"주물품",produced_qty:20,shipped_qty:7,before_quality:13,scrapped_qty:1,on_hand:12,held_qty:2,available_qty:10,untracked_count:1}],
  finished_inventory_orders:[{...work,tracked:true,routing_name:"기존 6공정",on_hand:12,held_qty:2,available_qty:10},{...work,wo_id:"WO-UNKNOWN",tracked:false,issue:"출고 전 공정 없음"}],
  inventory_movements:Array.from({length:1005},(_,i)=>({movement_id:i+1,stock_kind:"material",raw_code:"A",quantity_delta:i%2?-1.125:1.125,held_delta:0,event_kind:"원재료 투입",source_type:"material_usage",source_id:String(i+1),wo_id:"WO-LINKED",occurred_at:"2026-11-03T01:00:00Z",recorded_at:"2026-11-03T01:00:01Z",after_data:{input_qty:1.125}}))
 }};
 await page.route("**/rest/v1/**",async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split("/").pop(),headers={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,OPTIONS"};
  const ok=json=>route.fulfill({status:200,headers,json}),bad=(code,message)=>route.fulfill({status:400,headers,json:{code,message}});
  if(req.method()==="OPTIONS")return ok(null);
  if(req.method()==="GET"){
   state.reads.push(url.href);if(state.failSchema&&["sales_order_progress","material_receipts","material_inventory","finished_inventory","finished_inventory_orders"].includes(name))return bad("PGRST205","table missing");
   let rows=[...(state.tables[name]||[])];
   for(const key of ["stock_kind","raw_code","item_code","movement_id","occurred_at"])for(const v of url.searchParams.getAll(key)){const [op,...parts]=v.split("."),value=parts.join(".");rows=rows.filter(r=>op==="eq"?String(r[key])===value:op==="lte"?Number(r[key])<=Number(value):op==="gte"?r[key]>=value:op==="lt"?r[key]<value:true);}
   if(name==="inventory_movements")rows.sort((a,b)=>b.movement_id-a.movement_id);
   return ok(rows.slice(Number(url.searchParams.get("offset")||0),Number(url.searchParams.get("offset")||0)+Number(url.searchParams.get("limit")||1000)));
  }
  const args=req.postDataJSON();state.calls.push({name,args});
  if(state.stale)return bad("P0001","재고가 변경되었습니다. 새로고침 후 실사 수량을 다시 확인하세요");
  if(!state.requests.has(args.p_request_id)){
   let result={saved:true};
   if(name==="create_sales_work_order"){result={...work,...args.p_order,order_id:args.p_order_id};state.tables.work_orders.push(result);sales.allocated_qty+=Number(result.target_qty);sales.unallocated_qty-=Number(result.target_qty);sales.work_order_count++;}
   if(name==="save_sales_order"){result={...sales,...args.p_data,order_id:args.p_request_id,revision:1};state.tables.sales_order_progress.push(result);}
   if(name==="save_material_receipt"){result={...args.p_data,receipt_id:args.p_data.receipt_id||args.p_request_id,revision:2};if(args.p_create)state.tables.material_receipts.push(result);else state.tables.material_receipts[0]=result;}
   if(name==="void_material_receipt")state.tables.material_receipts[0].is_void=true;
   state.requests.set(args.p_request_id,result);
  }
  if(state.lose){state.lose=false;return route.abort("failed");}return ok(state.requests.get(args.p_request_id));
 });return state;
}
async function download(page,info,action){const waiting=page.waitForEvent("download");await action();const file=await waiting,path=info.outputPath(file.suggestedFilename());await file.saveAs(path);const parsed=spawnSync("python",["-B",fileURLToPath(new URL("../read_xlsx.py",import.meta.url)),path],{encoding:"utf8",maxBuffer:10_000_000});expect(parsed.status,parsed.stderr).toBe(0);return JSON.parse(parsed.stdout);}

test("sales preserves partial shipping and creates an arbitrary-sized linked order through the existing editor",async({page},info)=>{
 const state=await backend(page);await page.goto("/sales/");const card=page.locator(".erp-record");await expect(card).toContainText("7개");await expect(card).toContainText("93개");
 await expect(page.getByLabel("매출처",{exact:true}).locator("option")).toHaveCount(3);
 await card.getByRole("button",{name:"작업지시 생성"}).click();const modal=page.getByRole("dialog");
 await expect(modal.getByLabel("거래처",{exact:true})).toHaveValue("C");await expect(modal.getByLabel("품목",{exact:true})).toBeDisabled();await expect(modal.getByLabel("목표 수량 (개)")).toHaveValue("60");await expect(modal.getByLabel("납기일",{exact:true})).toHaveValue("2026-12-01");
 await modal.getByLabel("작업지시 번호").fill("WO-NEW");await modal.getByLabel("목표 수량 (개)").fill("17");await expect(modal.getByRole("button",{name:"작업지시 저장"})).toBeEnabled();await modal.screenshot({path:info.outputPath("sales-work-order.png")});await modal.getByRole("button",{name:"작업지시 저장"}).click();await expect(modal).toHaveCount(0);
 expect(state.calls[0].name).toBe("create_sales_work_order");expect(state.calls[0].args.p_order.target_qty).toBe("17");expect(state.calls[0].args.p_order_id).toBe(state.tables.sales_order_progress[0].order_id);await expect(card).toContainText("43개");
 await card.getByRole("link",{name:"연결 작업지시 보기"}).click();await expect(page.locator("article.order")).toHaveCount(2);await expect(page.locator("article.order").filter({hasText:"WO-OTHER"})).toHaveCount(0);
});
test("unknown save response retries the same request even after reloading and cannot duplicate a work order",async({page})=>{
 const state=await backend(page);await page.goto("/sales/");await page.getByRole("button",{name:"작업지시 생성"}).click();const modal=page.getByRole("dialog");await modal.getByLabel("작업지시 번호").fill("WO-RETRY");state.lose=true;
 await modal.getByRole("button",{name:"작업지시 저장"}).click();await expect(modal.locator(".alert[role=alert]")).toContainText("저장 결과");await expect(modal.getByRole("button",{name:"작업지시 저장"})).toBeDisabled();
 await page.reload();await page.getByRole("button",{name:"저장 결과 확인 / 재시도"}).click();await expect(page.locator(".scan-result.success")).toBeVisible();expect(state.calls).toHaveLength(2);expect(state.calls[0].args).toEqual(state.calls[1].args);expect(state.tables.work_orders.filter(w=>w.wo_id==="WO-RETRY")).toHaveLength(1);
});
test("purchase edits preserve decimal kg and zero price; cancellation keeps the original receipt",async({page},info)=>{
 const state=await backend(page);await page.goto("/purchases/");await expect(page.getByLabel("매입처",{exact:true}).locator("option")).toHaveCount(3);await page.getByRole("button",{name:"입고 수정",exact:true}).click();await expect(page.getByLabel("예상 총액")).toHaveValue("0원");await page.getByLabel("구매 수량 (kg)").fill("25.125");await page.getByLabel("구매 단가 (원/kg)").fill("1234.5");await expect(page.getByLabel("예상 총액")).toHaveValue("31,017원");await page.getByRole("button",{name:"입고 수정 저장"}).click();await expect(page.locator(".scan-result.success")).toBeVisible();expect(state.calls[0].args.p_expected_revision).toBe(1);expect(state.calls[0].args.p_data.quantity).toBe("25.125");
 const book=await download(page,info,()=>page.getByRole("button",{name:"엑셀 자료받기"}).click());expect(book["구매·입고"].rows[1][5]).toBe(25.125);expect(book["구매·입고"].rows[1][9]).toBe("=SUM(A1:A2)");
 page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"취소 / 삭제"}).click();await expect(page.locator("tbody tr")).toHaveCount(0);await page.getByLabel("입고 상태 필터").selectOption("void");await expect(page.locator("tbody tr")).toHaveCount(1);expect(state.calls[1].name).toBe("void_material_receipt");
});
test("stocktake rejects a stale snapshot and unknown finished goods are never presented as a full balance",async({page},info)=>{
 const state=await backend(page);await page.goto("/inventory/");await expect(page.locator("td.erp-negative")).toHaveText("-25.125");await page.getByRole("button",{name:"기초재고 확인"}).click();await page.getByLabel("실제 보유 수량 (kg)").fill("100");state.stale=true;await page.getByRole("button",{name:"기초재고 반영"}).click();await expect(page.locator(".alert[role=alert]")).toContainText("재고가 변경");expect(state.calls[0].args.p_stock_revision).toBe("1");expect(state.calls[0].args.p_counted_qty).toBe("100");
 await page.getByRole("button",{name:"완제품 재고",exact:true}).click();await expect(page.locator(".quantity-notice")).toContainText("전체 재고는 확인이 필요");await expect(page.locator(".erp-metrics")).toContainText("12개");await expect(page.locator(".erp-metrics")).toContainText("10개");await page.locator(".erp-work-breakdown summary").click();await expect(page.locator(".erp-work-breakdown")).toContainText("출고 전 공정 없음");await page.screenshot({path:info.outputPath("inventory.png"),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("stock history is paginated but Excel includes all matching rows with signed numeric quantities",async({page},info)=>{
 const state=await backend(page);await page.goto("/inventory/");await page.getByRole("button",{name:"수불 이력",exact:true}).click();const history=page.getByRole("region",{name:"수불 이력"});await expect(history.locator("tbody tr")).toHaveCount(100);await history.getByRole("button",{name:"다음",exact:true}).click();await expect(history).toContainText("2페이지");
 const book=await download(page,info,()=>history.getByRole("button",{name:"조회 조건 전체 엑셀"}).click());const sheet=book["수불 이력"];expect(sheet.rows).toHaveLength(1006);expect(sheet.rows[1][5]).toBe(1.125);expect(sheet.rows[2][5]).toBe(-1.125);expect(sheet.types[1][5]).toBe("n");expect(state.reads.some(s=>s.includes("offset=1000"))).toBe(true);expect(state.calls).toHaveLength(0);
});
test("unapplied ERP migration explains setup without disrupting existing work-order screens",async({page})=>{
 const state=await backend(page);state.failSchema=true;await page.goto("/sales/");await expect(page.locator(".alert[role=alert]")).toContainText("light_erp.sql");await expect(page.getByRole("button",{name:"수주 저장",exact:true})).toBeDisabled();await page.getByRole("navigation",{name:"주 메뉴"}).getByRole("link",{name:"작업지시 관리"}).click();await expect(page.locator("article.order")).toHaveCount(2);await expect(page.getByRole("link",{name:"수주에서 작업지시 생성",exact:true})).toHaveAttribute("href","/sales/");await page.locator("article.order").first().getByRole("button",{name:"수정 / 삭제"}).click();await expect(page.getByRole("dialog").getByRole("button",{name:"작업지시 저장"})).toBeEnabled();
});
