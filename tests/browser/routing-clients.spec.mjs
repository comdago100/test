import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tradeSteps=[{key:"receipt",name:"매입 입고",place:"입고장",role:"production"},
  {key:"check",name:"입고검사",place:"검사장",role:"inspection"},
  {key:"pack",name:"포장",place:"출고장",role:"production"},
  {key:"ship",name:"출고",place:"출고장",role:"shipment"}];
async function backend(page,{missingClients=false,missingRoutes=false}={}) {
  const state={calls:[],clients:[{client_code:"C",client_name:"주물 거래처",contact_info:"기존 연락처",client_type:"customer",is_active:true,client_updated_at:"2026-11-02T01:02:03.123456+00:00"}],
    routes:[{routing_code:"TRADE",routing_name:"완제품 매입·납품",steps:tradeSteps,description:"매입 후 납품",is_active:true,revision:1}],
    order:{wo_id:"WO-TRADE",client_code:"C",item_code:"I",target_qty:100,current_step:"부분출고",quantity_confirmed:true,
      routing_code:"TRADE",routing_name:"완제품 매입·납품",routing_steps:tradeSteps,process_quantities:{receipt:67,check:53,pack:39,ship:13}},events:[]};
  await page.route("**/rest/v1/**",async route=>{
    const request=route.request(), url=new URL(request.url()),table=url.pathname.split("/").pop();
    const headers={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,OPTIONS"};
    const ok=json=>route.fulfill({status:200,headers,json});
    if(request.method()==="OPTIONS")return ok(null);
    if(request.method()==="GET"){
      if(table==="clients" && missingClients && url.searchParams.get("select")!=="*")return route.fulfill({status:400,headers,json:{code:"42703",message:"missing column"}});
      if(table==="production_routings"&&missingRoutes)return route.fulfill({status:404,headers,json:{code:"42P01",message:"missing table"}});
      if(table==="work_orders")return ok(url.searchParams.has("wo_id")?state.order:[state.order]);
      return ok({clients:state.clients,production_routings:state.routes,production_events:state.events,items:[{item_code:"I",item_name:"제품"}],raw_materials:[],material_usage:[]}[table]||[]);
    }
    const args=request.postDataJSON();state.calls.push({rpc:table,args});
    if(table==="save_production_client"){
      const row={...state.clients.find(c=>c.client_code===args.p_client.client_code),...args.p_client,client_updated_at:"2026-11-02T02:00:00.123456+00:00"};
      state.clients=state.clients.filter(c=>c.client_code!==row.client_code).concat(row);return ok(row);
    }
    if(table==="save_production_routing"){
      const row={...args.p_route,revision:(args.p_expected_revision||0)+1};
      state.routes=state.routes.filter(r=>r.routing_code!==row.routing_code).concat(row);return ok(row);
    }
    if(table==="delete_production_routing"){state.routes=state.routes.map(r=>r.routing_code===args.p_code?{...r,is_active:false,revision:r.revision+1}:r);return ok({archived:true});}
    if(table==="record_production_progress"){
      const stage=state.order.routing_steps[args.p_step];state.order.process_quantities[stage.key]+=args.p_quantity;
      state.events.push({event_id:args.p_request_id,wo_id:state.order.wo_id,step:args.p_step,quantity:args.p_quantity,kind:"completion",created_at:new Date().toISOString()});
      return ok(state.order);
    }
    if(table==="save_routed_production_order")return ok(state.order);
    return ok(null);
  });
  return state;
}

test("routing copy supports add, rename, reorder and remove with an immutable issued-order explanation",async({page},testInfo)=>{
  const state=await backend(page);await page.goto("/routings/");
  await page.getByRole("button",{name:"복사 등록",exact:true}).click();
  await page.getByLabel("라우팅 코드 *",{exact:true}).fill("TRADE_REPAIR");
  await page.getByLabel("라우팅명 *",{exact:true}).fill("매입 보수 후 납품");
  await page.getByRole("button",{name:"공정 추가",exact:true}).click();
  await page.getByLabel("공정명 5",{exact:true}).fill("용접보수");
  await page.getByLabel("작업장 5",{exact:true}).fill("용접장");
  await page.getByRole("button",{name:"라우팅 저장",exact:true}).click();
  await expect(page.locator(".alert[role=alert]")).toContainText("출고 공정은 마지막");
  expect(state.calls).toHaveLength(0);
  await page.getByRole("button",{name:"5번 공정 위로",exact:true}).click();
  await page.getByRole("button",{name:"4번 공정 위로",exact:true}).click();
  await page.getByRole("button",{name:"2번 공정 삭제",exact:true}).click();
  await page.getByRole("button",{name:"라우팅 저장",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("라우팅을 저장했습니다");
  expect(state.calls[0].args.p_route.steps.map(s=>s.name)).toEqual(["매입 입고","용접보수","포장","출고"]);
  expect(state.calls[0].args.p_create).toBe(true);
  await expect(page.getByText("이미 발행된 작업의 순서·이름·누적 수량은 유지됩니다.",{exact:false})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("routing-management.png"),fullPage:true});
  const custom=page.locator(".routing-list-item").filter({hasText:"TRADE_REPAIR"});
  await custom.getByRole("button",{name:"수정",exact:true}).click();
  await page.getByLabel("공정명 2",{exact:true}).fill("사상보수");
  await page.getByRole("button",{name:"라우팅 저장",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("라우팅을 저장했습니다");
  expect(state.calls.at(-1).args.p_expected_revision).toBe(1);
  page.on("dialog",d=>d.accept());
  await custom.getByRole("button",{name:"삭제",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("사용중지했습니다");
});

test("purchase routing drives scanner quantities, shipment history and printed stages",async({page},testInfo)=>{
  const state=await backend(page);await page.goto("/scanner/?wo_id=WO-TRADE");
  await expect(page.locator(".station")).toHaveCount(4);
  await expect(page.locator(".station").first()).toContainText("매입 입고");
  await page.locator(".station").filter({has:page.getByText("출고",{exact:true})}).click();
  await expect(page.getByLabel("이번 처리 수량 (개)",{exact:true})).toHaveAttribute("max","26");
  await page.getByLabel("이번 처리 수량 (개)",{exact:true}).fill("7");
  await page.getByRole("button",{name:"출고 수량 기록",exact:true}).click();
  await expect(page.locator(".shipment-summary")).toContainText("누적 출고 20개");
  expect(state.calls[0].args.p_step).toBe(3);
  await page.goto("/orders/");
  await expect(page.locator(".stage-quantities>div")).toHaveCount(4);
  await page.getByRole("button",{name:"지시서 / QR 인쇄",exact:true}).click();
  await expect(page.locator(".print-stages>div")).toHaveCount(4);
  await expect(page.locator(".print-stages")).toContainText("매입 입고");
  await page.getByRole("button",{name:"인쇄 미리보기 닫기",exact:true}).click();
  await page.getByRole("button",{name:"엑셀 자료받기",exact:true}).click();
  const waiting=page.waitForEvent("download");await page.getByRole("button",{name:"엑셀 파일 받기",exact:true}).click();
  const download=await waiting,path=testInfo.outputPath("trade.xlsx");await download.saveAs(path);
  const read=spawnSync("python",["-B",fileURLToPath(new URL("../read_xlsx.py",import.meta.url)),path],{encoding:"utf8"});
  expect(read.status,read.stderr).toBe(0);const workbook=JSON.parse(read.stdout);
  expect(workbook["공정별 수량"].rows).toHaveLength(5);
  const shipped=workbook["출고 이력"].rows;expect(shipped).toHaveLength(2);
  expect(shipped[1][shipped[0].indexOf("처리 수량(개)")]).toBe(7);
});

test("work orders start from sales and legacy orders retain their routing",async({page})=>{
  const state=await backend(page);await page.goto("/orders/");
  await expect(page.getByRole("button",{name:"작업지시 등록",exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"수주에서 작업지시 생성",exact:true})).toHaveAttribute("href","/sales/");
  await page.getByRole("button",{name:"수정 / 삭제",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("라우팅",{exact:false})).toHaveValue("완제품 매입·납품");
  await expect(dialog.getByLabel("거래처",{exact:true})).toBeDisabled();
  await expect(dialog.getByLabel("품목",{exact:true})).toBeDisabled();
  expect(state.calls).toHaveLength(0);
});

test("client optional profiles create and edit with precise concurrency token and search",async({page},testInfo)=>{
  const state=await backend(page);await page.goto("/clients/");
  await page.getByLabel("거래처 코드 *",{exact:true}).fill("001");await page.getByLabel("거래처명 *",{exact:true}).fill("매입 업체");
  await page.getByLabel("거래처 구분",{exact:true}).selectOption("both");
  await page.getByLabel("담당자명",{exact:true}).fill("김담당");
  await page.locator("summary").filter({hasText:"사업자 정보"}).click();
  await page.getByLabel("사업자등록번호",{exact:false}).fill("123-45-67890");
  await page.locator("summary").filter({hasText:"주소·납품"}).click();
  await page.getByLabel("납품 주소",{exact:false}).fill("제2공장 입고장");
  await page.getByRole("button",{name:"거래처 등록",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("등록이 완료");
  expect(state.calls[0].args.p_client.business_number).toBe("1234567890");
  await page.getByLabel("거래처 검색",{exact:true}).fill("김담당");
  await expect(page.locator(".client-table tbody tr")).toHaveCount(1);
  await page.getByRole("button",{name:"상세 / 수정",exact:true}).click();
  await expect(page.locator(".client-form input[readonly]")).toHaveValue("001");
  await page.getByLabel("사용 상태",{exact:true}).selectOption("inactive");
  await page.getByRole("button",{name:"거래처 수정 저장",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("수정이 완료");
  expect(state.calls.at(-1).args.p_expected_updated_at).toBe("2026-11-02T02:00:00.123456+00:00");
  await expect(page.locator(".client-table tbody")).toContainText("거래중지");
  await page.screenshot({path:testInfo.outputPath("client-profile.png"),fullPage:true});
});

test("missing schema explains setup while keeping basic client and existing orders available",async({page})=>{
  const state=await backend(page,{missingClients:true,missingRoutes:true});
  await page.goto("/clients/");
  await expect(page.getByRole("status")).toContainText("코드·거래처명 등록");
  await expect(page.getByLabel("담당자명",{exact:true})).toBeDisabled();
  await page.getByLabel("거래처 코드 *",{exact:true}).fill("BASIC");await page.getByLabel("거래처명 *",{exact:true}).fill("기본 거래처");
  await page.getByRole("button",{name:"거래처 등록",exact:true}).click();
  await expect(page.locator(".client-form").getByRole("status")).toContainText("등록이 완료");
  expect(state.calls[0].rpc).toBe("create_production_master");
  await page.goto("/routings/");await expect(page.locator(".alert[role=alert]")).toContainText("routing_management.sql");
  await expect(page.getByRole("button",{name:"라우팅 저장",exact:true})).toBeDisabled();
  await page.goto("/orders/");await expect(page.getByText("WO-TRADE",{exact:true})).toBeVisible();
});
