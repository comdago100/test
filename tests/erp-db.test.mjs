import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
let db,oldWo;
const file=n=>readFile(new URL("../supabase/"+n,import.meta.url),"utf8");
const query=async(s,p=[]) => (await db.query(s,p)).rows;
const rpc=async(name,values)=>(await query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as r`,values.map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v)))[0].r;
const fresh=async(target=20,route="LEGACY")=>rpc("save_routed_production_order",[{wo_id:randomUUID(),client_code:"C",item_code:"I",target_qty:target,routing_code:route},[],true,[]]);
const record=(id,step,q)=>rpc("record_production_progress",[id,step,q,randomUUID(),""]);
const sales=(data,create=true,rev=null,id=randomUUID())=>rpc("save_sales_order",[{order_no:randomUUID(),client_code:"C",item_code:"I",quantity:100,due_date:"2026-12-01",...data},create,rev,id]);
const receipt=(data,create=true,rev=null,id=randomUUID())=>rpc("save_material_receipt",[{client_code:"S",raw_code:"A",received_on:"2026-11-03",quantity:"10",unit_price:"100",...data},create,rev,id]);
const stock=async(code="A")=>(await query("select * from public.material_inventory where raw_code=$1",[code]))[0];
const product=async(code="I")=>(await query("select * from public.finished_inventory where item_code=$1",[code]))[0];
const progress=async id=>(await query("select * from public.sales_order_progress where order_id=$1",[id]))[0];
const linked=(order,data={},req=randomUUID())=>rpc("create_sales_work_order",[order.order_id,order.revision,{wo_id:randomUUID(),target_qty:100,routing_code:"CAST",...data},[],req]);
async function reconcile(){
 const rows=await query(`select a.raw_code,a.on_hand,coalesce(sum(m.quantity_delta),0) as ledger from material_inventory a left join inventory_movements m on m.stock_kind='material' and m.raw_code=a.raw_code group by a.raw_code,a.on_hand`);
 for(const r of rows)assert.equal(Number(r.on_hand),Number(r.ledger),r.raw_code);
 const goods=await query(`select a.item_code,a.on_hand,a.held_qty,coalesce(sum(m.quantity_delta),0) as ledger,coalesce(sum(m.held_delta),0) as ledger_held from finished_inventory a left join inventory_movements m on m.stock_kind='product' and m.item_code=a.item_code group by a.item_code,a.on_hand,a.held_qty`);
 for(const r of goods){assert.equal(Number(r.on_hand),Number(r.ledger),r.item_code);assert.equal(Number(r.held_qty),Number(r.ledger_held),r.item_code);}
}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table clients(client_code text primary key,client_name text,contact_info text);create table items(item_code text primary key,item_name text,unit_weight numeric);
 create table raw_materials(raw_code text primary key,raw_name text,unit text);
 create table work_orders(wo_id text primary key,client_code text,item_code text,target_qty numeric,current_step text,created_at timestamptz default now());
 create table material_usage(usage_id bigint generated always as identity primary key,wo_id text references work_orders,raw_code text,input_qty numeric,input_date timestamptz default clock_timestamp());
 insert into clients values('C','Customer',''),('S','Supplier',''),('B','Both','');insert into items values('I','Item',0),('J','Other',0);
 insert into raw_materials values('A','Material A','kg'),('B','Material B','kg');`);
 for(const n of ["production_management.sql","anonymous_management.sql","partial_production.sql","client_management.sql","routing_management.sql","quality_management.sql"])await db.exec(await file(n));
 await db.exec("update clients set client_type=case client_code when 'S' then 'supplier' when 'B' then 'both' else 'customer' end");
 oldWo=(await fresh()).wo_id;for(let i=0;i<5;i++)await record(oldWo,i,20);await record(oldWo,5,5);
 const hold=randomUUID();await rpc("record_production_defect",[oldWo,5,3,"available","균열",hold,""]);await rpc("resolve_production_defect",[oldWo,hold,"scrap",1,randomUUID(),""]);
 await query("insert into material_usage(wo_id,raw_code,input_qty) values($1,'A',25)",[oldWo]);
 await db.exec(await file("light_erp.sql"));
 await db.exec("grant select on clients,items,raw_materials,work_orders,material_usage to anon,authenticated");
});
after(async()=>{await db?.close();});
test("bootstrap uses existing source data without changing orders and reconciles both ledgers",async()=>{
 assert.equal(Number((await stock()).on_hand),-25);const p=await product();
 assert.equal(Number(p.before_quality),15);assert.equal(Number(p.on_hand),14);assert.equal(Number(p.available_qty),12);assert.equal(Number(p.held_qty),2);await reconcile();
});
test("receipt decimals, edits, material changes and cancellation recalculate source sums exactly",async()=>{
 let r=await receipt({quantity:"25.125",unit_price:"1234.5"});assert.equal(Number(r.amount),31017);assert.equal(Number((await stock()).on_hand),0.125);
 r=await receipt({...r,quantity:"30"},false,r.revision);assert.equal(Number((await stock()).on_hand),5);
 r=await receipt({...r,raw_code:"B"},false,r.revision);assert.equal(Number((await stock()).on_hand),-25);assert.equal(Number((await stock("B")).on_hand),30);
 await rpc("void_material_receipt",[r.receipt_id,r.revision,randomUUID()]);assert.equal(Number((await stock("B")).on_hand),0);await reconcile();
});
test("stocktake stores a signed opening adjustment and rejects stale stock revisions",async()=>{
 let s=await stock();let r=await rpc("save_material_opening",["A",100,s.stock_revision,"기초 실사",randomUUID()]);
 assert.equal(Number(r.quantity),125);assert.equal(Number((await stock()).on_hand),100);
 const stale=(await stock()).stock_revision;const purchase=await receipt({quantity:200});
 await assert.rejects(rpc("save_material_opening",["A",100,stale,"",randomUUID()]),/재고가 변경/);
 s=await stock();r=await rpc("save_material_opening",["A",100,s.stock_revision,"실사 정정",randomUUID()]);assert.equal(Number(r.quantity),-75);assert.equal(Number((await stock()).on_hand),100);
 await rpc("void_material_receipt",[purchase.receipt_id,purchase.revision,randomUUID()]);await reconcile();
});
test("direct desktop usage inserts, updates, code changes and deletes have matching ledger corrections",async()=>{
 const wo=(await fresh()).wo_id;const [u]=await query("insert into material_usage(wo_id,raw_code,input_qty) values($1,'A',12.25) returning *",[wo]);
 const before=Number((await stock()).on_hand);await query("update material_usage set input_qty=10 where usage_id=$1",[u.usage_id]);assert.equal(Number((await stock()).on_hand),before+2.25);
 await query("update material_usage set raw_code='B' where usage_id=$1",[u.usage_id]);await reconcile();
 await rpc("delete_production_order",[wo]);assert.equal(Number((await stock("B")).on_hand),0);await reconcile();
});
test("sales uses eligible customers and nullable price; source work-order targets reserve the order quantity",async()=>{
 await assert.rejects(sales({client_code:"S"}),/매출처/);await assert.rejects(receipt({client_code:"C"}),/매입처/);
 let s=await sales({unit_price:""});assert.equal(s.amount,null);
 const wo=await linked(s,{target_qty:40});assert.equal(wo.order_id,s.order_id);assert.equal(wo.client_code,s.client_code);assert.equal(wo.due_date,s.due_date);
 let p=await progress(s.order_id);assert.equal(Number(p.allocated_qty),40);assert.equal(Number(p.unallocated_qty),60);
 await assert.rejects(linked(s,{target_qty:61}),/초과/);
 await assert.rejects(sales({...s,quantity:39},false,s.revision),/목표 합계/);
 await assert.rejects(sales({...s,item_code:"J"},false,s.revision),/거래처·품목/);
 await assert.rejects(rpc("delete_sales_order",[s.order_id,s.revision,randomUUID()]),/연결된/);
 s=await sales({...s,unit_price:"500",due_date:"2026-12-02"},false,s.revision);assert.equal(Number(s.amount),50000);
 const [old]=await query("select due_date::text as due_date from work_orders where wo_id=$1",[wo.wo_id]);assert.equal(old.due_date,"2026-12-01");await reconcile();
});
test("the existing scanner shipment is the sales shipment, including reversals, without a shipping table",async()=>{
 const s=await sales({quantity:20}),wo=await linked(s,{target_qty:20,routing_code:"TRADE"});
 for(let i=0;i<3;i++)await record(wo.wo_id,i,20);const req=randomUUID();await rpc("record_production_progress",[wo.wo_id,3,7,req,""]);
 let p=await progress(s.order_id);assert.equal(Number(p.shipped_qty),7);assert.equal(p.status,"부분 출하");
 assert.equal(p.work_orders[0].wo_id,wo.wo_id);assert.equal(Number(p.work_orders[0].shipped_qty),7);
 await rpc("reverse_production_progress",[req,randomUUID()]);p=await progress(s.order_id);assert.equal(Number(p.shipped_qty),0);await reconcile();
 await rpc("delete_production_order",[wo.wo_id]);assert.equal(Number((await progress(s.order_id)).allocated_qty),0);await reconcile();
});
test("request retries, optimistic revisions and double creation do not duplicate effects",async()=>{
 const req=randomUUID(),data={quantity:"4"};const a=await receipt(data,true,null,req),b=await receipt(data,true,null,req);assert.equal(a.receipt_id,b.receipt_id);
 await assert.rejects(receipt({quantity:"5"},true,null,req),/동일 요청/);
 const updated=await receipt({...a,quantity:"5"},false,a.revision);await assert.rejects(receipt({...a,quantity:"6"},false,a.revision),/다른 사용자가/);
 const s=await sales({quantity:5}),woId=randomUUID(),request=randomUUID();const x=await linked(s,{wo_id:woId,target_qty:5},request),y=await linked(s,{wo_id:woId,target_qty:5},request);assert.equal(x.wo_id,y.wo_id);
 const [n]=await query("select count(*) as n from work_orders where order_id=$1",[s.order_id]);assert.equal(Number(n.n),1);await reconcile();
 await rpc("void_material_receipt",[updated.receipt_id,updated.revision,randomUUID()]);
});
test("late production defects, outgoing scrap and rework reconcile stock after every correction",async()=>{
 const wo=(await fresh(20)).wo_id;for(let i=0;i<5;i++)await record(wo,i,20);
 const balance=async()=> (await query("select * from finished_inventory_orders where wo_id=$1",[wo]))[0];
 const hold=randomUUID();await rpc("record_production_defect",[wo,4,3,"completed","검사 불량",hold,""]);assert.equal(Number((await balance()).on_hand),17);await reconcile();
 const cancel=randomUUID();await rpc("resolve_production_defect",[wo,hold,"cancel",1,cancel,""]);assert.equal(Number((await balance()).on_hand),18);await reconcile();
 await rpc("reverse_production_quality",[wo,cancel,randomUUID(),""]);assert.equal(Number((await balance()).on_hand),17);await reconcile();
 await rpc("resolve_production_defect",[wo,hold,"rework",3,randomUUID(),""]);await record(wo,4,3);assert.equal(Number((await balance()).on_hand),20);await reconcile();
 const outgoing=randomUUID();await rpc("record_production_defect",[wo,5,5,"available","출고 전 균열",outgoing,""]);assert.equal(Number((await balance()).available_qty),15);await reconcile();
 const scrap=randomUUID();await rpc("resolve_production_defect",[wo,outgoing,"scrap",2,scrap,""]);assert.equal(Number((await balance()).on_hand),18);assert.equal(Number((await balance()).held_qty),3);await reconcile();
 await rpc("reverse_production_quality",[wo,scrap,randomUUID(),""]);assert.equal(Number((await balance()).on_hand),20);await reconcile();
 await rpc("resolve_production_defect",[wo,outgoing,"rework",5,randomUUID(),""]);await record(wo,5,7);assert.equal(Number((await balance()).on_hand),13);await reconcile();
 await rpc("delete_production_order",[wo]);await reconcile();
});
test("shipment-only routing remains unknown for finished stock but still contributes to sales shipping",async()=>{
 await rpc("save_production_routing",[{routing_code:"SHIP",routing_name:"출고만",steps:[{key:"ship",name:"출고",role:"shipment",place:"출고장"}],is_active:true},true,null]);
 const s=await sales({quantity:10}),w=await linked(s,{target_qty:10,routing_code:"SHIP"});await record(w.wo_id,0,4);
 const [r]=await query("select * from finished_inventory_orders where wo_id=$1",[w.wo_id]);assert.equal(r.tracked,false);assert.equal(r.on_hand,null);assert.equal(r.issue,"출고 전 공정 없음");assert.equal(Number((await progress(s.order_id)).shipped_qty),4);await reconcile();
});
test("concurrent allocations cannot exceed a sales order and linked identifiers cannot be reassigned",async()=>{
 const s=await sales({quantity:30});const results=await Promise.allSettled([linked(s,{target_qty:20}),linked(s,{target_qty:20})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(Number((await progress(s.order_id)).allocated_qty),20);
 const w=results.find(r=>r.status==="fulfilled").value;await assert.rejects(query("update work_orders set order_id=null where wo_id=$1",[w.wo_id]),/연결/);await assert.rejects(query("update work_orders set target_qty=31 where wo_id=$1",[w.wo_id]),/초과/);await reconcile();
});
test("migration reruns preserve snapshots and do not seed live rows twice; public clients cannot edit the audit",async()=>{
 const rows=await query("select count(*) as n from inventory_movements"),before=await product();
 await db.exec(await file("light_erp.sql"));assert.deepEqual(await product(),before);assert.deepEqual(await query("select count(*) as n from inventory_movements"),rows);await reconcile();
 await db.exec("set role anon");try{await query("select * from material_inventory");await query("select * from sales_order_progress");await assert.rejects(query("delete from inventory_movements"),/permission denied/);}finally{await db.exec("reset role");}
});
