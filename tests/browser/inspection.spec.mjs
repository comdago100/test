import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const details={po_no:'PO-001',po_line:'0010',item_name:'밸브',size:'DN100',material:'FC250',specification:'고객 규격 A',classification:'고객 요구',drawing_no:'D01 Rev.A',extra:''};
async function backend(page){
 const state={calls:[],missing:false,lose:false,requests:new Map(),tables:{clients:[{client_code:'C',client_name:'매출처',client_type:'customer',is_active:true}],items:[{item_code:'I',item_name:'밸브',unit_weight:2.75,product_details:{...details,po_no:'',po_line:''},profile_revision:1}],raw_materials:[],material_usage:[],inspection_reports:[],inspection_report_history:[],sales_order_progress:[{order_id:randomUUID(),order_no:'SO-001',client_code:'C',item_code:'I',quantity:100,unallocated_qty:100,allocated_qty:0,work_order_count:0,unconfirmed_count:0,shipped_qty:0,remaining_qty:100,revision:1,due_date:'2026-12-01',status:'수주 등록',product_details:{...details}}],production_routings:[{routing_code:'TEST',routing_name:'검사 출고',is_active:true,steps:[{key:'check',name:'검사',role:'inspection',place:'검사장'},{key:'ship',name:'출고',role:'shipment',place:'출고장'}]}]}};
 state.tables.work_orders=Array.from({length:23},(_,i)=>({wo_id:'WO-'+String(i+1).padStart(3,'0'),client_code:'C',item_code:'I',target_qty:100,details_revision:1,product_details:{...details},heat_no:'HEAT-1',quantity_confirmed:true,current_step:'발행대기',created_at:new Date(Date.UTC(2026,10,1,0,i)).toISOString(),routing_code:'TEST',routing_name:'검사 출고',routing_steps:state.tables.production_routings[0].steps,process_quantities:{check:0,ship:0},quality_quantities:{}}));
 await page.route('**/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
  const ok=json=>route.fulfill({status:200,headers,json}),fail=(code,message)=>route.fulfill({status:400,headers,json:{code,message}});
  if(req.method()==='OPTIONS')return ok(null);
  if(req.method()==='GET'){
   if(state.missing&&name.startsWith('inspection_'))return fail('PGRST205','inspection_reports is missing');
   if(name==='sales_orders')return ok(state.tables.sales_order_progress.find(r=>r.order_id===url.searchParams.get('order_id')?.slice(3)));
   if(name==='work_orders'&&url.searchParams.has('wo_id'))return ok(state.tables.work_orders.find(r=>r.wo_id===url.searchParams.get('wo_id').slice(3)));
   let rows=[...(state.tables[name]||[])];if(url.searchParams.has('report_id'))rows=rows.filter(r=>r.report_id===url.searchParams.get('report_id').slice(3));
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);return ok(rows.slice(offset,offset+limit));
  }
  const a=req.postDataJSON();state.calls.push({name,args:a});if(!state.requests.has(a.p_request_id)){
   let result={};
   if(name==='save_item_profile'){result={...a.p_data,profile_revision:2};state.tables.items[0]=result;}
   if(name==='save_detailed_sales_order'){result={...a.p_data,order_id:randomUUID(),revision:1};}
   if(name==='create_detailed_sales_work_order'){result={...state.tables.work_orders[0],...a.p_order,product_details:{...state.tables.sales_order_progress[0].product_details},order_id:a.p_order_id};state.tables.work_orders.push(result);}
   if(name==='save_detailed_work_order'){const w=state.tables.work_orders.find(w=>w.wo_id===a.p_order.wo_id);result={...w,...a.p_order,details_revision:w.details_revision+1};Object.assign(w,result);}
   if(name==='save_inspection_report'){
    const w=state.tables.work_orders.find(w=>w.wo_id===a.p_data.wo_id),old=state.tables.inspection_reports.find(r=>r.report_id===a.p_data.report_id);
    result={...a.p_data,report_id:old?.report_id||a.p_request_id,document:{...a.p_data.document,product:{...w.product_details,item_code:w.item_code,client_name:'매출처',heat_no:w.heat_no}},status:'draft',judgement:'pending',revision:(old?.revision||0)+1};if(old)Object.assign(old,result);else state.tables.inspection_reports.push(result);
   }
   if(name==='set_inspection_status'){const r=state.tables.inspection_reports.find(r=>r.report_id===a.p_report_id);if(a.p_status==='issued'&&r.document.tests.some(t=>!t.result||t.judgement==='pending'))return fail('P0001','모든 결과를 입력하세요');result={...r,status:a.p_status,revision:r.revision+1,judgement:r.document.tests.some(t=>t.judgement==='fail')?'fail':'pass',void_reason:a.p_reason};Object.assign(r,result);}
   if(name.includes('inspection'))state.tables.inspection_report_history.push({history_id:state.tables.inspection_report_history.length+1,report_id:result.report_id,revision:result.revision,status:result.status,snapshot:structuredClone(result),recorded_at:new Date().toISOString()});
   state.requests.set(a.p_request_id,structuredClone(result));
  }if(state.lose){state.lose=false;return route.abort('failed');}return ok(state.requests.get(a.p_request_id));
 });return state;
}
test('pagination keeps summaries and Excel over the whole filtered result and remembers page size',async({page},info)=>{
 await backend(page);await page.goto('/orders/');const nav=page.getByRole('navigation',{name:'목록 페이지 탐색',exact:true});await expect(page.locator('article.order')).toHaveCount(10);await expect(nav).toContainText('총 23건');await nav.getByRole('button',{name:'다음',exact:true}).click();await expect(nav.getByLabel('페이지 이동',{exact:true})).toHaveValue('2');
 await nav.getByLabel('페이지당 표시 수').selectOption('5');await expect(page.locator('article.order')).toHaveCount(5);await nav.getByRole('button',{name:'마지막',exact:true}).click();await expect(page.locator('article.order')).toHaveCount(3);await page.getByLabel('작업지시 검색',{exact:true}).fill('WO-001');await expect(page.locator('article.order')).toHaveCount(1);await expect(nav.getByLabel('페이지 이동',{exact:true})).toHaveValue('1');await page.getByLabel('작업지시 검색',{exact:true}).fill('');
 await page.getByRole('button',{name:'엑셀 자료받기',exact:true}).click();const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'엑셀 파일 받기',exact:true}).click();const file=await waiting,path=info.outputPath('paginated.xlsx');await file.saveAs(path);const parsed=spawnSync('python',['-B',fileURLToPath(new URL('../read_xlsx.py',import.meta.url)),path],{encoding:'utf8'});expect(parsed.status).toBe(0);const book=JSON.parse(parsed.stdout);expect(book['작업지시 현황'].rows).toHaveLength(24);expect(book['작업지시 현황'].rows[0]).toContain('제품 PO 라인번호');
 await page.goto('/orders/');await expect(page.locator('article.order')).toHaveCount(5);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('product master details prefill orders while PO and quantities remain order-specific',async({page})=>{
 const s=await backend(page);await page.goto('/items/');await page.getByRole('button',{name:'제품정보 수정',exact:true}).click();await expect(page.getByLabel('사이즈',{exact:true})).toHaveValue('DN100');await expect(page.getByLabel('PO번호',{exact:true})).toHaveCount(0);await page.getByLabel('사이즈',{exact:true}).fill('DN200');await page.getByRole('button',{name:'제품정보 저장',exact:true}).click();await expect(page.locator('.scan-result.success')).toBeVisible();expect(s.calls[0].name).toBe('save_item_profile');
 await page.goto('/sales/');await page.getByLabel('수주 품목',{exact:true}).selectOption('I');await expect(page.getByLabel('사이즈',{exact:true})).toHaveValue('DN200');await expect(page.getByLabel('PO번호',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'작업지시 생성',exact:true}).click();const modal=page.getByRole('dialog');await expect(modal.getByLabel('PO번호',{exact:true})).toHaveCount(0);await expect(modal.locator('.product-summary')).toContainText('0010');await expect(modal.locator('.product-summary')).toContainText('DN100');await modal.getByLabel('작업지시 번호').fill('WO-NEW');await modal.getByLabel('목표 수량 (개)').fill('17');await modal.getByRole('button',{name:'작업지시 저장'}).click();await expect(modal).toHaveCount(0);expect(s.calls.at(-1).name).toBe('create_detailed_sales_work_order');expect(s.calls.at(-1).args.p_order.target_qty).toBe('17');
});
test('inspection draft, lost-response retry, issue, print and void retain results without posting production',async({page},info)=>{
 const s=await backend(page);await page.goto('/inspections/?wo_id=WO-001');await page.getByLabel('성적서 번호 *',{exact:true}).fill('IR-001');await page.getByLabel('제조사 / 발행업체').fill('테스트 제조사');await page.getByLabel('대상 로트수량 (개)').fill('17');await page.getByLabel('실제 검사수량 (개)').fill('5');await page.getByLabel('검사자',{exact:true}).fill('검사 담당');await page.getByLabel('확인자',{exact:true}).fill('검토 담당');
 await expect(page.locator('.inspection-test')).toHaveCount(1);
 for(const row of await page.locator('.inspection-test').all()){await row.getByLabel('기준 / 허용값').fill('고객 승인 기준');await row.getByLabel('실측 / 검사 결과').fill('이상 없음');await row.getByLabel('항목 판정').selectOption('pass');}
 s.lose=true;await page.getByRole('button',{name:'초안 저장',exact:true}).click();await expect(page.locator('.alert[role=alert]')).toContainText('저장 결과');await page.getByRole('button',{name:'저장 결과 확인 / 재시도'}).click();await expect(page.locator('article.erp-record')).toHaveCount(1);expect(s.calls[0].args).toEqual(s.calls[1].args);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'성적서 발행',exact:true}).click();await expect(page.locator('article.erp-record')).toContainText('발행 · 합격');await expect(page.getByRole('button',{name:'초안 수정'})).toHaveCount(0);
 await page.getByRole('button',{name:'성적서 / 인쇄'}).click();const print=page.getByRole('dialog');await expect(print).toContainText('PO-001');await expect(print).toContainText('0010');await expect(print).toContainText('HEAT-1');await expect(print).toContainText('발행본');await print.screenshot({path:info.outputPath('inspection-print.png')});await page.emulateMedia({media:'print'});const pdf=info.outputPath('inspection.pdf');await page.pdf({path:pdf,format:'A4',printBackground:true});const pdfBytes=await readFile(pdf);expect(pdfBytes.byteLength).toBeGreaterThan(10000);expect((pdfBytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length).toBe(1);await page.emulateMedia({media:'screen'});await page.getByRole('button',{name:'미리보기 닫기'}).click();
 await page.getByRole('button',{name:'항목 복사 (결과 초기화)'}).click();await expect(page.locator('.inspection-test').first().getByLabel('실측 / 검사 결과')).toHaveValue('');await page.getByRole('button',{name:'입력창 접기'}).click();await page.getByRole('button',{name:'취소 / 삭제',exact:true}).click();await page.getByLabel('성적서 취소 사유').fill('수치 정정 후 새 번호 발행');await page.getByRole('button',{name:'성적서 취소 확정'}).click();await expect(page.locator('article.erp-record')).toContainText('취소');expect(s.calls.some(c=>c.name==='record_production_progress')).toBe(false);
});
test('missing inspection schema explains setup and leaves production pages available',async({page})=>{
 const s=await backend(page);s.missing=true;await page.goto('/inspections/');await expect(page.locator('.alert[role=alert]')).toContainText('product_inspection.sql');await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'작업지시 관리'}).click();await expect(page.locator('article.order')).toHaveCount(10);
});

test('sales leads to a linked work order, scanner and one-row inspection editor',async({page},info)=>{
 const s=await backend(page);await page.goto('/orders/');
 await expect(page.locator('article.order')).toHaveCount(10);await page.locator('article.order').first().getByRole('link',{name:'작업지시',exact:true}).click();await expect(page.locator('article.order')).toHaveCount(1);
 await page.getByRole('link',{name:'수주에서 작업지시 생성',exact:true}).click();
 await page.getByRole('button',{name:'작업지시 생성',exact:true}).click();const editor=page.getByRole('dialog');
 await expect(editor.getByLabel('PO번호',{exact:true})).toHaveCount(0);
 await expect(editor.locator('.product-summary')).toContainText('PO-001');
 await editor.getByLabel('작업지시 번호').fill('WO-CHAIN');await editor.getByLabel('목표 수량 (개)').fill('17');await editor.getByRole('button',{name:'작업지시 저장'}).click();await expect(editor).toHaveCount(0);
 const salesId=s.tables.sales_order_progress[0].order_id;
 await page.goto('/orders/?order_id='+salesId);await expect(page.locator('article.order')).toHaveCount(1);
 await page.locator('article.order').getByRole('link',{name:'공정처리',exact:true}).click();await expect(page.locator('.station')).toHaveCount(2);
 await expect(page.locator('.workflow-links').getByRole('link',{name:'연결 수주'})).toHaveAttribute('href','/sales/?order_id='+salesId);
 await page.locator('.workflow-links').getByRole('link',{name:'검사성적서',exact:true}).click();
 await expect(page.getByLabel('연결 작업지시')).toHaveValue('WO-CHAIN');await expect(page.locator('.inspection-test')).toHaveCount(1);
 await page.getByRole('button',{name:'검사 항목 추가',exact:true}).click();await expect(page.locator('.inspection-test')).toHaveCount(2);
 await page.goto('/inspections/?order_id='+salesId);await page.getByRole('button',{name:'새 성적서 작성'}).click();await expect(page.locator('#inspection-work-orders option')).toHaveCount(1);await expect(page.locator('#inspection-work-orders option')).toHaveAttribute('value','WO-CHAIN');
 await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'기초정보'}).click();await expect(page.locator('.master-card')).toHaveCount(3);await expect(page.getByRole('link',{name:'제품 등록',exact:false})).toHaveAttribute('href','/items/');
 await page.screenshot({path:info.outputPath('master-data.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('link',{name:'구매·입고'}).click();await expect(page.getByRole('heading',{name:'구매·입고',exact:true})).toBeVisible();
 expect(s.calls.map(c=>c.name)).toEqual(['create_detailed_sales_work_order']);
});

test('work order can explicitly import revised sales details without entering a second PO',async({page})=>{
 const s=await backend(page),sale=s.tables.sales_order_progress[0],w=s.tables.work_orders[0];w.order_id=sale.order_id;
 sale.product_details={...details,po_no:'PO-REVISED',size:'DN200'};sale.due_date='2026-12-15';
 await page.goto('/orders/?wo_id='+w.wo_id);await page.getByRole('button',{name:'수정 / 삭제',exact:true}).click();const editor=page.getByRole('dialog');
 await expect(editor.getByLabel('PO번호',{exact:true})).toHaveCount(0);await expect(editor.locator('.product-summary')).toContainText('PO-001');
 await editor.getByRole('button',{name:'수주 최신정보 가져오기'}).click();await expect(editor.locator('.product-summary')).toContainText('PO-REVISED');await expect(editor.getByLabel('납기일',{exact:true})).toHaveValue('2026-12-15');expect(s.calls).toHaveLength(0);
 await editor.getByRole('button',{name:'작업지시 저장'}).click();await expect(editor).toHaveCount(0);expect(s.calls[0].name).toBe('save_detailed_work_order');expect(s.calls[0].args.p_order.product_details.po_no).toBe('PO-REVISED');expect(s.calls[0].args.p_create).toBe(false);expect(s.calls[0].args.p_expected_revision).toBe(1);
});
