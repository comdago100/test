import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
let db;
const file=n=>readFile(new URL('../supabase/'+n,import.meta.url),'utf8');
const q=async(s,p=[]) => (await db.query(s,p)).rows;
const rpc=async(n,v)=>(await q(`select public.${n}(${v.map((_,i)=>'$'+(i+1)).join(',')}) r`,v.map(x=>x&&typeof x==='object'?JSON.stringify(x):x)))[0].r;
const details={po_no:'PO-001',po_line:'0010',item_name:'주물 밸브',size:'DN100',material:'FC250',specification:'고객 지정 규격',classification:'요구 선급',drawing_no:'D01 Rev.A',extra:'참고 메모'};
const fresh=async()=>rpc('save_detailed_work_order',[{wo_id:randomUUID(),client_code:'C',item_code:'I',target_qty:100,routing_code:'CAST',product_details:details,heat_no:'H-1'},[],true,[],null,randomUUID()]);
const doc=()=>({manufacturer:'제조사',manufacturer_address:'주소',inspector:'검사자',reviewer:'확인자',external_ref:'',remarks:'',inspected_on:'2026-11-03',issued_on:'2026-11-03',inspection_qty:5,lot_qty:17,tests:[{group:'dimension',name:'길이',standard:'100 ± 1',method:'캘리퍼',unit:'mm',result:'100.2',judgement:'pass',remark:''}]});
const save=(wo,data={},rev=null,id=randomUUID())=>rpc('save_inspection_report',[{report_no:randomUUID(),wo_id:wo,document:doc(),...data},rev,id]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table clients(client_code text primary key,client_name text,contact_info text);create table items(item_code text primary key,item_name text,unit_weight numeric);create table raw_materials(raw_code text primary key,raw_name text,unit text);
 create table work_orders(wo_id text primary key,client_code text,item_code text,target_qty numeric,current_step text,created_at timestamptz default now());create table material_usage(usage_id bigint generated always as identity primary key,wo_id text references work_orders,raw_code text,input_qty numeric,input_date timestamptz default now());
 insert into clients values('C','매출처','');insert into items values('I','제품',0);insert into raw_materials values('A','선철','kg');`);
 for(const n of ['production_management.sql','anonymous_management.sql','partial_production.sql','client_management.sql','routing_management.sql','quality_management.sql','light_erp.sql','product_inspection.sql'])await db.exec(await file(n));
 await db.exec('grant select on work_orders,items,clients,raw_materials,material_usage to anon,authenticated');
});
after(async()=>db?.close());
test('product snapshots flow from sales to work orders and remain fixed when the master or sales changes',async()=>{
 let item=await rpc('save_item_profile',[{item_code:'I',item_name:'주물 밸브',product_details:details},false,1,randomUUID()]);assert.equal(item.product_details.po_no,undefined);
 let s=await rpc('save_detailed_sales_order',[{order_no:randomUUID(),client_code:'C',item_code:'I',quantity:100,due_date:'2026-12-01',product_details:details},true,null,randomUUID()]);
 const request=randomUUID(),args=[s.order_id,s.revision,{wo_id:randomUUID(),target_qty:17,routing_code:'CAST',product_details:{po_no:'spoof'}},[],request];const w=await rpc('create_detailed_sales_work_order',args);assert.equal(w.product_details.po_no,'PO-001');assert.equal(w.casting_material,'FC250');assert.deepEqual(await rpc('create_detailed_sales_work_order',args),w);
 s=await rpc('save_detailed_sales_order',[{...s,product_details:{...details,size:'DN200'}},false,s.revision,randomUUID()]);
 await rpc('save_item_profile',[{...item,product_details:{...details,size:'DN300'}},false,item.profile_revision,randomUUID()]);
 assert.equal((await q('select product_details from work_orders where wo_id=$1',[w.wo_id]))[0].product_details.size,'DN100');assert.equal((await q('select product_details from sales_order_progress where order_id=$1',[s.order_id]))[0].product_details.size,'DN200');
});
test('inspection issue freezes the document and never changes process or inventory quantities',async()=>{
 const w=await fresh(),r=await save(w.wo_id),before=(await q('select process_quantities,quality_quantities from work_orders where wo_id=$1',[w.wo_id]))[0];
 const issued=await rpc('set_inspection_status',[r.report_id,r.revision,'issued','',randomUUID()]);assert.equal(issued.judgement,'pass');assert.equal(issued.document.product.po_line,'0010');
 await assert.rejects(save(w.wo_id,{...issued,document:doc()},issued.revision),/수정할 수 없습니다/);
 await rpc('save_detailed_work_order',[{...w,product_details:{...details,size:'DN500'}},[],false,[],w.details_revision,randomUUID()]);assert.equal((await q('select document from inspection_reports where report_id=$1',[r.report_id]))[0].document.product.size,'DN100');
 assert.deepEqual((await q('select process_quantities,quality_quantities from work_orders where wo_id=$1',[w.wo_id]))[0],before);
 const voided=await rpc('set_inspection_status',[issued.report_id,issued.revision,'void','잘못된 측정값 확인',randomUUID()]);assert.equal(voided.status,'void');assert.equal((await q('select count(*) n from inspection_report_history where report_id=$1',[r.report_id]))[0].n,3);
 await assert.rejects(rpc('delete_production_order',[w.wo_id]),/foreign key/);
});
test('missing results cannot be issued and one failed row makes the overall result fail',async()=>{
 const w=await fresh(),d=doc();d.tests[0].result='';let r=await save(w.wo_id,{document:d});await assert.rejects(rpc('set_inspection_status',[r.report_id,r.revision,'issued','',randomUUID()]),/모든 항목/);
 d.tests[0].result='103';d.tests[0].judgement='fail';r=await save(w.wo_id,{...r,document:d},r.revision);r=await rpc('set_inspection_status',[r.report_id,r.revision,'issued','',randomUUID()]);assert.equal(r.judgement,'fail');
 const na=doc();na.tests[0]={...na.tests[0],judgement:'na',result:'해당 없음',remark:'고객 요구 제외'};r=await save(w.wo_id,{document:na});await assert.rejects(rpc('set_inspection_status',[r.report_id,r.revision,'issued','',randomUUID()]),/실제 판정/);
});
test('quantity bounds, revision conflicts and retries are validated atomically',async()=>{
 const w=await fresh();await assert.rejects(save(w.wo_id,{document:{...doc(),inspection_qty:18}}),/검사수량/);await assert.rejects(save(w.wo_id,{document:{...doc(),lot_qty:101}}),/검사수량/);
 const id=randomUUID(),data={report_no:randomUUID(),wo_id:w.wo_id,document:doc()},args=[data,null,id];const a=await rpc('save_inspection_report',args);assert.deepEqual(await rpc('save_inspection_report',args),a);
 await assert.rejects(rpc('save_inspection_report',[{...data,report_no:'DIFFERENT'},null,id]),/동일 요청/);
 await save(w.wo_id,{...a,document:doc()},a.revision);await assert.rejects(save(w.wo_id,{...a,document:doc()},a.revision),/변경되었습니다/);
 const retry=await rpc('save_inspection_report',args);assert.equal(retry.revision,1);assert.equal((await q('select revision from inspection_reports where report_id=$1',[a.report_id]))[0].revision,2);
});
test('public users read immutable reports and use management RPCs; migration reruns retain issued snapshots',async()=>{
 const before=await q('select * from inspection_reports order by report_id');await db.exec(await file('product_inspection.sql'));assert.deepEqual(await q('select * from inspection_reports order by report_id'),before);
 await db.exec('set role anon');try{await q('select * from inspection_reports');await assert.rejects(q("update inspection_reports set status='draft'"),/permission denied/);const w=await fresh();assert.equal(w.product_details.po_no,'PO-001');}finally{await db.exec('reset role');}
});
