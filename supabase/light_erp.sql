-- Apply after quality_management.sql. Additive: preserves the existing routing/quality guard and scanner RPCs.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_orders' and column_name='quality_quantities') then
  raise exception '먼저 quality_management.sql을 적용하세요';
 end if;
end; $$;
lock table public.work_orders,public.material_usage in share row exclusive mode;
alter table public.material_usage add column if not exists input_date timestamptz default clock_timestamp();

create table if not exists public.sales_orders(
 order_id uuid primary key, order_no text not null unique check(length(order_no) between 1 and 80),
 client_code text not null references public.clients(client_code),item_code text not null references public.items(item_code),
 quantity integer not null check(quantity>0),unit_price numeric check(unit_price>=0 and unit_price::text not in ('NaN','Infinity','-Infinity')),
 amount numeric generated always as(round(quantity*unit_price,0)) stored,due_date date not null,notes text not null default '' check(length(notes)<=2000),
 revision integer not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
alter table public.work_orders add column if not exists order_id uuid references public.sales_orders(order_id) on delete restrict;
create index if not exists work_orders_sales_order on public.work_orders(order_id);

create table if not exists public.material_receipts(
 receipt_id uuid primary key,kind text not null default 'purchase' check(kind in ('purchase','opening')),
 client_code text references public.clients(client_code),raw_code text not null references public.raw_materials(raw_code),
 received_on date not null,quantity numeric not null check(quantity::text not in ('NaN','Infinity','-Infinity')),
 unit_price numeric check(unit_price>=0 and unit_price::text not in ('NaN','Infinity','-Infinity')),
 amount numeric generated always as(case when kind='purchase' then round(quantity*unit_price,0) end) stored,
 counted_qty numeric check(counted_qty>=0 and counted_qty::text not in ('NaN','Infinity','-Infinity')),
 notes text not null default '' check(length(notes)<=2000),is_void boolean not null default false,revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((kind='purchase' and client_code is not null and quantity>0 and unit_price is not null and counted_qty is null)
 or(kind='opening' and client_code is null and unit_price is null and counted_qty is not null))
);
create index if not exists material_receipts_material on public.material_receipts(raw_code) where not is_void;
create unique index if not exists one_material_opening on public.material_receipts(raw_code) where kind='opening' and not is_void;

create table if not exists public.inventory_movements(
 movement_id bigint generated always as identity primary key,
 stock_kind text not null check(stock_kind in ('material','product')),
 raw_code text references public.raw_materials(raw_code),item_code text references public.items(item_code),
 quantity_delta numeric not null,held_delta numeric not null default 0,
 event_kind text not null,source_type text not null,source_id text not null,wo_id text,
 occurred_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 before_data jsonb,after_data jsonb,
 check((stock_kind='material' and raw_code is not null and item_code is null and held_delta=0)
 or(stock_kind='product' and item_code is not null and raw_code is null and quantity_delta=trunc(quantity_delta) and held_delta=trunc(held_delta)))
);
create index if not exists inventory_material_history on public.inventory_movements(raw_code,occurred_at,movement_id);
create index if not exists inventory_product_history on public.inventory_movements(item_code,occurred_at,movement_id);
create table if not exists public.erp_requests(request_id uuid primary key,kind text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table if not exists public.inventory_bootstrap(singleton boolean primary key default true check(singleton),created_at timestamptz not null default clock_timestamp());

-- Exact quantities come from current source facts, not increment/decrement balance columns.
create or replace view public.material_inventory with(security_invoker=true) as
with r as(select raw_code,sum(quantity) filter(where kind='purchase') as purchased_qty,sum(quantity) filter(where kind='opening') as opening_qty from public.material_receipts where not is_void group by raw_code),
 u as(select raw_code,sum(input_qty) as used_qty from public.material_usage group by raw_code),
 m as(select raw_code,max(movement_id)::text as stock_revision from public.inventory_movements where stock_kind='material' group by raw_code)
select a.raw_code,a.raw_name,a.unit,coalesce(r.purchased_qty,0) as purchased_qty,coalesce(r.opening_qty,0) as opening_qty,coalesce(u.used_qty,0) as used_qty,
 coalesce(r.purchased_qty,0)+coalesce(r.opening_qty,0)-coalesce(u.used_qty,0) as on_hand,
 coalesce(m.stock_revision,'0') as stock_revision,
 exists(select 1 from public.material_receipts x where x.raw_code=a.raw_code and x.kind='opening' and not x.is_void) as opening_confirmed
from public.raw_materials a left join r using(raw_code) left join u using(raw_code) left join m using(raw_code);

create or replace function public.erp_stock_components(p_row jsonb)
returns table(item_code text,tracked boolean,produced numeric,shipped numeric,held numeric,scrapped numeric)
language sql immutable set search_path=public,pg_temp as $$
 with s as(select p_row->'routing_steps' as stages), n as(select stages,jsonb_array_length(stages) as count from s)
 select p_row->>'item_code',coalesce((p_row->>'quantity_confirmed')::boolean,false) and count>=2,
 case when count>=2 then coalesce((p_row->'process_quantities'->>coalesce(stages->(count-2)->>'key',stages->(count-2)->>'name'))::numeric,0) end,
 case when count>=1 then coalesce((p_row->'process_quantities'->>coalesce(stages->(count-1)->>'key',stages->(count-1)->>'name'))::numeric,0) end,
 case when count>=1 then coalesce((p_row->'quality_quantities'->coalesce(stages->(count-1)->>'key',stages->(count-1)->>'name')->>'held')::numeric,0) end,
 case when count>=1 then coalesce((p_row->'quality_quantities'->coalesce(stages->(count-1)->>'key',stages->(count-1)->>'name')->>'scrapped')::numeric,0) end from n;
$$;
create or replace view public.finished_inventory_orders with(security_invoker=true) as
select w.wo_id,w.order_id,w.client_code,w.item_code,w.routing_name,w.quantity_confirmed,c.tracked,
 case when c.tracked then c.produced end as produced_qty,case when w.quantity_confirmed then c.shipped end as shipped_qty,
 case when c.tracked then c.held end as held_qty,case when c.tracked then c.scrapped end as scrapped_qty,
 case when c.tracked then c.produced-c.shipped end as before_quality,
 case when c.tracked then c.produced-c.shipped-c.scrapped end as on_hand,
 case when c.tracked then c.produced-c.shipped-c.scrapped-c.held end as available_qty,
 case when not w.quantity_confirmed then '수량 확인 필요' when not c.tracked then '출고 전 공정 없음' else '' end as issue
from public.work_orders w cross join lateral public.erp_stock_components(to_jsonb(w)) c;
create or replace view public.finished_inventory with(security_invoker=true) as
with q as(select item_code,sum(produced_qty) as produced_qty,sum(shipped_qty) filter(where tracked) as shipped_qty,sum(held_qty) as held_qty,sum(scrapped_qty) as scrapped_qty,
 sum(before_quality) as before_quality,sum(on_hand) as on_hand,sum(available_qty) as available_qty,count(*) filter(where not tracked) as untracked_count from public.finished_inventory_orders group by item_code)
select i.item_code,i.item_name,coalesce(q.produced_qty,0) as produced_qty,coalesce(q.shipped_qty,0) as shipped_qty,coalesce(q.held_qty,0) as held_qty,coalesce(q.scrapped_qty,0) as scrapped_qty,
 coalesce(q.before_quality,0) as before_quality,coalesce(q.on_hand,0) as on_hand,coalesce(q.available_qty,0) as available_qty,coalesce(q.untracked_count,0) as untracked_count
from public.items i left join q using(item_code);
create or replace view public.sales_order_progress with(security_invoker=true) as
with q as(select w.order_id,count(*) as work_order_count,sum(w.target_qty) as allocated_qty,
 sum(case when w.quantity_confirmed then c.shipped else 0 end) as shipped_qty,count(*) filter(where not w.quantity_confirmed) as unconfirmed_count
 ,jsonb_agg(jsonb_build_object('wo_id',w.wo_id,'current_step',w.current_step,'target_qty',w.target_qty,'shipped_qty',case when w.quantity_confirmed then c.shipped end,'quantity_confirmed',w.quantity_confirmed) order by w.wo_id) as work_orders
 from public.work_orders w cross join lateral public.erp_stock_components(to_jsonb(w)) c where w.order_id is not null group by w.order_id)
select s.*,coalesce(q.work_order_count,0) as work_order_count,coalesce(q.allocated_qty,0) as allocated_qty,
 s.quantity-coalesce(q.allocated_qty,0) as unallocated_qty,coalesce(q.shipped_qty,0) as shipped_qty,
 s.quantity-coalesce(q.shipped_qty,0) as remaining_qty,coalesce(q.unconfirmed_count,0) as unconfirmed_count,
 case when coalesce(q.unconfirmed_count,0)>0 then '수량 확인 필요' when coalesce(q.shipped_qty,0)>=s.quantity then '출하 완료'
 when coalesce(q.shipped_qty,0)>0 then '부분 출하' when coalesce(q.allocated_qty,0)>0 then '작업 진행' else '수주 등록' end as status,
 coalesce(q.work_orders,'[]'::jsonb) as work_orders
from public.sales_orders s left join q using(order_id);

-- All raw-stock mutations share a transaction lock. Existing PC writes pass through it too.
create or replace function public.erp_lock_usage()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old text;v_new text;
begin
 if tg_op<>'INSERT' then v_old:=old.wo_id;end if;
 if tg_op<>'DELETE' then v_new:=new.wo_id;end if;
 perform 1 from public.work_orders where wo_id in(v_old,v_new) order by wo_id for update;
 perform pg_advisory_xact_lock(748220);
 if tg_op='DELETE' then return old;else return new;end if;
end; $$;
create or replace function public.erp_lock_receipt()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform pg_advisory_xact_lock(748220);if tg_op='DELETE' then return old;else return new;end if;end; $$;

create or replace function public.erp_audit_material()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb;a jsonb;v_qty numeric;v_code text;v_active boolean;v_day timestamptz;v_source text;v_id text;v_wo text;
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 if a is not distinct from b then return null;end if;
 v_source:=tg_table_name;
 if tg_table_name='material_usage' then
  v_id:=coalesce(a->>'usage_id',b->>'usage_id');v_wo:=coalesce(a->>'wo_id',b->>'wo_id');
 else v_id:=coalesce(a->>'receipt_id',b->>'receipt_id');end if;
 for side in 0..1 loop
  declare r jsonb:=case when side=0 then b else a end;
  begin
   if r is null then continue;end if;
   v_active:=tg_table_name='material_usage' or not (r->>'is_void')::boolean;
   if not v_active then continue;end if;
   v_code:=r->>'raw_code';
   if tg_table_name='material_usage' then v_qty:=-(r->>'input_qty')::numeric;v_day:=coalesce((r->>'input_date')::timestamptz,clock_timestamp());
   else v_qty:=(r->>'quantity')::numeric;v_day:=(r->>'received_on')::date::timestamp at time zone 'Asia/Seoul';end if;
   if side=0 then v_qty:=-v_qty;end if;
   insert into public.inventory_movements(stock_kind,raw_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
   values('material',v_code,v_qty,case when tg_table_name='material_usage' then case when side=0 then '투입 정정' else '원재료 투입' end
    when r->>'kind'='opening' then case when side=0 then '기초조정 취소' else '기초조정' end else case when side=0 then '입고 정정' else '구매 입고' end end,
    v_source,v_id,v_wo,v_day,b,a);
  end;
 end loop;
 return null;
end; $$;

create or replace function public.erp_audit_finished()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb;a jsonb;c record;v_before record;v_after record;v_sign integer;v_wo text;
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 if b is not null and a is not null and (b->'process_quantities',b->'quality_quantities',b->>'quantity_confirmed',b->>'item_code')
  is not distinct from(a->'process_quantities',a->'quality_quantities',a->>'quantity_confirmed',a->>'item_code') then return null;end if;
 v_wo:=coalesce(a->>'wo_id',b->>'wo_id');
 if b is not null and a is not null then
  select * into v_before from public.erp_stock_components(b);select * into v_after from public.erp_stock_components(a);
  if v_before.tracked and v_after.tracked and v_before.item_code is not distinct from v_after.item_code and v_after.item_code is not null then
   insert into public.inventory_movements(stock_kind,item_code,quantity_delta,held_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
   select 'product',v_after.item_code,x.qty,x.hold,x.kind,'work_orders',v_wo,v_wo,clock_timestamp(),b,a from (values
    (v_after.produced-v_before.produced,0::numeric,'생산 수량 반영'),
    (v_before.shipped-v_after.shipped,0::numeric,'출고 수량 반영'),
    (v_before.scrapped-v_after.scrapped,0::numeric,'완제품 폐기 반영'),
    (0::numeric,v_after.held-v_before.held,'완제품 보류 반영')
   ) x(qty,hold,kind) where x.qty<>0 or x.hold<>0;
   return null;
  end if;
 end if;
 -- Record the old snapshot reversal and new snapshot together; the current-stock view never depends on this log.
 for side in 0..1 loop
  declare r jsonb:=case when side=0 then b else a end;
  begin
   if r is null then continue;end if;
   select * into c from public.erp_stock_components(r);
   if not c.tracked or c.item_code is null then continue;end if;
   v_sign:=case when side=0 then -1 else 1 end;
   if c.produced<>0 then insert into public.inventory_movements(stock_kind,item_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
    values('product',c.item_code,c.produced*v_sign,'생산 수량 반영','work_orders',v_wo,v_wo,clock_timestamp(),b,a);end if;
   if c.shipped<>0 then insert into public.inventory_movements(stock_kind,item_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
    values('product',c.item_code,-c.shipped*v_sign,'출고 수량 반영','work_orders',v_wo,v_wo,clock_timestamp(),b,a);end if;
   if c.scrapped<>0 then insert into public.inventory_movements(stock_kind,item_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
    values('product',c.item_code,-c.scrapped*v_sign,'완제품 폐기 반영','work_orders',v_wo,v_wo,clock_timestamp(),b,a);end if;
   if c.held<>0 then insert into public.inventory_movements(stock_kind,item_code,quantity_delta,held_delta,event_kind,source_type,source_id,wo_id,occurred_at,before_data,after_data)
    values('product',c.item_code,0,c.held*v_sign,'완제품 보류 반영','work_orders',v_wo,v_wo,clock_timestamp(),b,a);end if;
  end;
 end loop;
 return null;
end; $$;

-- Seed once. Old scans retain their timestamps; opening counts retain their explicit opening classification.
do $$ declare v_seed boolean;
begin
 insert into public.inventory_bootstrap(singleton) values(true) on conflict do nothing returning singleton into v_seed;
 if v_seed then
  insert into public.inventory_movements(stock_kind,raw_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,after_data)
   select 'material',u.raw_code,-u.input_qty,'기존 원재료 투입','material_usage',u.usage_id::text,u.wo_id,coalesce(u.input_date,clock_timestamp()),to_jsonb(u) from public.material_usage u;
  insert into public.inventory_movements(stock_kind,item_code,quantity_delta,event_kind,source_type,source_id,wo_id,occurred_at,after_data)
   select 'product',w.item_code,case when e.step=jsonb_array_length(w.routing_steps)-1 then -e.quantity else e.quantity end,
   case when e.kind='opening' then '기존 기초수량' when e.step=jsonb_array_length(w.routing_steps)-1 then '기존 출고 이력' else '기존 생산 이력' end,
   'production_events',e.event_id::text,w.wo_id,e.created_at,to_jsonb(e)
   from public.production_events e join public.work_orders w using(wo_id)
   where w.quantity_confirmed and w.item_code is not null and jsonb_array_length(w.routing_steps)>=2 and e.step in(jsonb_array_length(w.routing_steps)-2,jsonb_array_length(w.routing_steps)-1);
  insert into public.inventory_movements(stock_kind,item_code,quantity_delta,held_delta,event_kind,source_type,source_id,wo_id,occurred_at,after_data)
  select 'product',w.item_code,
   case when e.step=jsonb_array_length(w.routing_steps)-2 then
     case when e.kind='hold_completed' then -e.quantity when coalesce(o.kind,e.kind)='cancel' and h.kind='hold_completed' then e.quantity else 0 end
    else case when coalesce(o.kind,e.kind)='scrap' then -e.quantity else 0 end end,
   case when e.step=jsonb_array_length(w.routing_steps)-1 then case when e.kind in('hold_available','hold_completed') then e.quantity else -e.quantity end else 0 end,
   '기존 불량 반영','production_quality_events',e.event_id::text,w.wo_id,e.created_at,to_jsonb(e)
   from public.production_quality_events e join public.work_orders w using(wo_id)
   left join public.production_quality_events o on o.event_id=e.reversal_of
   left join public.production_quality_events h on h.event_id=e.defect_id
   where w.quantity_confirmed and w.item_code is not null and jsonb_array_length(w.routing_steps)>=2 and e.step in(jsonb_array_length(w.routing_steps)-2,jsonb_array_length(w.routing_steps)-1);
 end if;
end; $$;
drop trigger if exists erp_lock_usage on public.material_usage;
create trigger erp_lock_usage before insert or update or delete on public.material_usage for each row execute function public.erp_lock_usage();
drop trigger if exists erp_audit_usage on public.material_usage;
create trigger erp_audit_usage after insert or update or delete on public.material_usage for each row execute function public.erp_audit_material();
drop trigger if exists erp_lock_receipt on public.material_receipts;
create trigger erp_lock_receipt before insert or update or delete on public.material_receipts for each row execute function public.erp_lock_receipt();
drop trigger if exists erp_audit_receipt on public.material_receipts;
create trigger erp_audit_receipt after insert or update or delete on public.material_receipts for each row execute function public.erp_audit_material();
drop trigger if exists erp_audit_finished on public.work_orders;
create trigger erp_audit_finished after insert or update or delete on public.work_orders for each row execute function public.erp_audit_finished();

create or replace function public.erp_request(p_request_id uuid,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.erp_requests%rowtype;
begin
 perform public.check_routing_manager();
 if p_request_id is null then raise exception '요청 번호가 필요합니다';end if;
 perform pg_advisory_xact_lock(hashtextextended('erp:request:'||p_request_id::text,0));
 select * into r from public.erp_requests where request_id=p_request_id;
 if found then
  if r.kind is distinct from p_kind or r.payload is distinct from p_payload then raise exception '동일 요청 번호로 다른 내용을 저장할 수 없습니다';end if;
  return r.result;
 end if;
 return null;
end; $$;
create or replace function public.erp_request_done(p_request_id uuid,p_kind text,p_payload jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.erp_requests(request_id,kind,payload,result) values(p_request_id,p_kind,p_payload,p_result);return p_result;end; $$;

create or replace function public.save_sales_order(p_data jsonb,p_create boolean,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb:=jsonb_build_object('data',p_data,'create',p_create,'revision',p_expected_revision);v_cached jsonb;
 v_row public.sales_orders%rowtype;v_id uuid:=coalesce(nullif(p_data->>'order_id','')::uuid,p_request_id);v_qty numeric:=(p_data->>'quantity')::numeric;v_alloc numeric;
begin
 v_cached:=public.erp_request(p_request_id,'save_sales_order',v_payload);if v_cached is not null then return v_cached;end if;
 if p_create is null or coalesce(length(trim(p_data->>'order_no')),0) not between 1 and 80 or v_qty is null or v_qty::text in('NaN','Infinity','-Infinity') or v_qty<1 or v_qty<>trunc(v_qty) or v_qty>2147483647
  or nullif(p_data->>'due_date','') is null or length(coalesce(p_data->>'notes',''))>2000 then raise exception '수주번호·수량·납기일을 확인하세요';end if;
 if not p_create then
  select * into v_row from public.sales_orders where order_id=v_id for update;
  if not found then raise exception '수주를 찾을 수 없습니다';end if;
  if v_row.revision is distinct from p_expected_revision then raise exception '다른 사용자가 수주를 수정했습니다. 새로고침하세요';end if;
  select coalesce(sum(target_qty),0) into v_alloc from public.work_orders where order_id=v_id;
  if v_qty<v_alloc then raise exception '수주 수량은 연결된 작업지시 목표 합계 %개보다 작을 수 없습니다',v_alloc;end if;
  if exists(select 1 from public.work_orders where order_id=v_id) and (v_row.client_code,v_row.item_code) is distinct from(p_data->>'client_code',p_data->>'item_code') then
   raise exception '작업지시가 연결된 수주의 거래처·품목은 변경할 수 없습니다';end if;
 end if;
 if (p_create or v_row.client_code is distinct from p_data->>'client_code') and not exists(select 1 from public.clients where client_code=p_data->>'client_code' and is_active and client_type in('customer','both')) then raise exception '사용 중인 매출처를 선택하세요';end if;
 if not exists(select 1 from public.items where item_code=p_data->>'item_code') then raise exception '등록된 품목을 선택하세요';end if;
 if p_create then
  insert into public.sales_orders(order_id,order_no,client_code,item_code,quantity,unit_price,due_date,notes)
   values(v_id,trim(p_data->>'order_no'),p_data->>'client_code',p_data->>'item_code',v_qty::integer,nullif(p_data->>'unit_price','')::numeric,(p_data->>'due_date')::date,coalesce(trim(p_data->>'notes'),'')) returning * into v_row;
 else
  update public.sales_orders set order_no=trim(p_data->>'order_no'),client_code=p_data->>'client_code',item_code=p_data->>'item_code',quantity=v_qty::integer,
   unit_price=nullif(p_data->>'unit_price','')::numeric,due_date=(p_data->>'due_date')::date,notes=coalesce(trim(p_data->>'notes'),''),revision=revision+1,updated_at=clock_timestamp() where order_id=v_id returning * into v_row;
 end if;
 return public.erp_request_done(p_request_id,'save_sales_order',v_payload,to_jsonb(v_row));
end; $$;
create or replace function public.delete_sales_order(p_order_id uuid,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('id',p_order_id,'revision',p_expected_revision);r public.sales_orders%rowtype;c jsonb;
begin
 c:=public.erp_request(p_request_id,'delete_sales_order',p);if c is not null then return c;end if;
 select * into r from public.sales_orders where order_id=p_order_id for update;
 if not found then raise exception '수주를 찾을 수 없습니다';end if;
 if r.revision is distinct from p_expected_revision then raise exception '수주가 변경되었습니다. 새로고침하세요';end if;
 if exists(select 1 from public.work_orders where order_id=p_order_id) then raise exception '작업지시가 연결된 수주는 삭제할 수 없습니다';end if;
 delete from public.sales_orders where order_id=p_order_id;
 return public.erp_request_done(p_request_id,'delete_sales_order',p,jsonb_build_object('deleted',true));
end; $$;

create or replace function public.guard_sales_work_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.sales_orders%rowtype;v_alloc numeric;
begin
 if tg_op='UPDATE' then
  if (new.order_id,new.target_qty,new.client_code,new.item_code) is not distinct from(old.order_id,old.target_qty,old.client_code,old.item_code) then return new;end if;
  if old.order_id is not null and new.order_id is distinct from old.order_id then raise exception '작업지시의 수주 연결은 변경할 수 없습니다';end if;
 end if;
 if new.order_id is null then return new;end if;
 if (tg_op='INSERT' or old.order_id is null) and coalesce(current_setting('app.erp_linking',true),'')<>new.wo_id then raise exception '수주 관리의 작업지시 생성 기능을 사용하세요';end if;
 select * into r from public.sales_orders where order_id=new.order_id for update;
 if not found then raise exception '연결할 수주를 찾을 수 없습니다';end if;
 if (new.client_code,new.item_code) is distinct from(r.client_code,r.item_code) then raise exception '수주와 작업지시의 거래처·품목이 일치해야 합니다';end if;
 select coalesce(sum(target_qty),0) into v_alloc from public.work_orders where order_id=new.order_id and wo_id<>new.wo_id;
 if v_alloc+new.target_qty>r.quantity then raise exception '작업지시 목표 합계가 수주 수량을 초과합니다';end if;
 return new;
end; $$;
drop trigger if exists z_guard_sales_work_order on public.work_orders;
create trigger z_guard_sales_work_order before insert or update of order_id,target_qty,client_code,item_code on public.work_orders for each row execute function public.guard_sales_work_order();
create or replace function public.create_sales_work_order(p_order_id uuid,p_expected_revision integer,p_order jsonb,p_materials jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('id',p_order_id,'revision',p_expected_revision,'order',p_order,'materials',p_materials);c jsonb;r public.sales_orders%rowtype;v_result jsonb;v_id text:=trim(p_order->>'wo_id');
begin
 c:=public.erp_request(p_request_id,'create_sales_work_order',p);if c is not null then return c;end if;
 select * into r from public.sales_orders where order_id=p_order_id for update;
 if not found then raise exception '수주를 찾을 수 없습니다';end if;
 if r.revision is distinct from p_expected_revision then raise exception '수주가 변경되었습니다. 다시 열어 주세요';end if;
 if not exists(select 1 from public.clients where client_code=r.client_code and is_active and client_type in('customer','both')) then raise exception '사용 중인 매출처인지 확인하세요';end if;
 perform public.save_routed_production_order(p_order||jsonb_build_object('client_code',r.client_code,'item_code',r.item_code,'due_date',r.due_date),p_materials,true,'[]');
 perform set_config('app.erp_linking',v_id,true);
 update public.work_orders set order_id=p_order_id where wo_id=v_id returning to_jsonb(work_orders) into v_result;
 perform set_config('app.erp_linking','',true);
 return public.erp_request_done(p_request_id,'create_sales_work_order',p,v_result);
end; $$;

create or replace function public.save_material_receipt(p_data jsonb,p_create boolean,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('data',p_data,'create',p_create,'revision',p_expected_revision);c jsonb;r public.material_receipts%rowtype;
 v_id uuid:=coalesce(nullif(p_data->>'receipt_id','')::uuid,p_request_id);v_qty numeric:=(p_data->>'quantity')::numeric;v_price numeric:=(p_data->>'unit_price')::numeric;
begin
 c:=public.erp_request(p_request_id,'save_material_receipt',p);if c is not null then return c;end if;
 perform pg_advisory_xact_lock(748220);
 if p_create is null or v_qty is null or v_qty<=0 or v_qty::text in('NaN','Infinity','-Infinity') or v_price is null or v_price<0 or v_price::text in('NaN','Infinity','-Infinity')
 or nullif(p_data->>'received_on','') is null or length(coalesce(p_data->>'notes',''))>2000 then raise exception '입고일·수량·단가를 확인하세요';end if;
 if not p_create then
  select * into r from public.material_receipts where receipt_id=v_id for update;
  if not found or r.is_void or r.kind<>'purchase' then raise exception '수정할 구매 입고를 찾을 수 없습니다';end if;
  if r.revision is distinct from p_expected_revision then raise exception '다른 사용자가 입고를 수정했습니다. 새로고침하세요';end if;
 end if;
 if (p_create or r.client_code is distinct from p_data->>'client_code') and not exists(select 1 from public.clients where client_code=p_data->>'client_code' and is_active and client_type in('supplier','both')) then raise exception '사용 중인 매입처를 선택하세요';end if;
 if not exists(select 1 from public.raw_materials where raw_code=p_data->>'raw_code' and unit='kg') then raise exception 'kg 원재료를 선택하세요';end if;
 if p_create then
  insert into public.material_receipts(receipt_id,client_code,raw_code,received_on,quantity,unit_price,notes)
   values(v_id,p_data->>'client_code',p_data->>'raw_code',(p_data->>'received_on')::date,v_qty,v_price,coalesce(trim(p_data->>'notes'),'')) returning * into r;
 else
  update public.material_receipts set client_code=p_data->>'client_code',raw_code=p_data->>'raw_code',received_on=(p_data->>'received_on')::date,quantity=v_qty,unit_price=v_price,
   notes=coalesce(trim(p_data->>'notes'),''),revision=revision+1,updated_at=clock_timestamp() where receipt_id=v_id returning * into r;
 end if;
 return public.erp_request_done(p_request_id,'save_material_receipt',p,to_jsonb(r));
end; $$;
create or replace function public.void_material_receipt(p_receipt_id uuid,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('id',p_receipt_id,'revision',p_expected_revision);c jsonb;r public.material_receipts%rowtype;
begin
 c:=public.erp_request(p_request_id,'void_material_receipt',p);if c is not null then return c;end if;
 perform pg_advisory_xact_lock(748220);
 select * into r from public.material_receipts where receipt_id=p_receipt_id for update;
 if not found or r.is_void then raise exception '취소할 입고를 찾을 수 없습니다';end if;
 if r.revision is distinct from p_expected_revision then raise exception '입고가 변경되었습니다. 새로고침하세요';end if;
 update public.material_receipts set is_void=true,revision=revision+1,updated_at=clock_timestamp() where receipt_id=p_receipt_id returning * into r;
 return public.erp_request_done(p_request_id,'void_material_receipt',p,to_jsonb(r));
end; $$;
create or replace function public.save_material_opening(p_raw_code text,p_counted_qty numeric,p_stock_revision text,p_note text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('raw',p_raw_code,'counted',p_counted_qty,'stock_revision',p_stock_revision,'note',p_note);c jsonb;r public.material_receipts%rowtype;
 v_revision text;v_base numeric;v_old numeric:=0;v_found boolean;
begin
 c:=public.erp_request(p_request_id,'save_material_opening',p);if c is not null then return c;end if;
 perform pg_advisory_xact_lock(748220);
 if p_counted_qty is null or p_counted_qty<0 or p_counted_qty::text in('NaN','Infinity','-Infinity') or length(coalesce(p_note,''))>2000 then raise exception '실사 수량은 0 이상의 kg으로 입력하세요';end if;
 if not exists(select 1 from public.raw_materials where raw_code=p_raw_code and unit='kg') then raise exception 'kg 원재료를 선택하세요';end if;
 select stock_revision,on_hand into v_revision,v_base from public.material_inventory where raw_code=p_raw_code;
 if v_revision is distinct from p_stock_revision then raise exception '재고가 변경되었습니다. 새로고침 후 실사 수량을 다시 확인하세요';end if;
 select * into r from public.material_receipts where raw_code=p_raw_code and kind='opening' and not is_void for update;
 v_found:=found;if v_found then v_old:=r.quantity;end if;
 v_base:=v_base-v_old;
 if v_found then
  update public.material_receipts set quantity=p_counted_qty-v_base,counted_qty=p_counted_qty,notes=coalesce(trim(p_note),''),revision=revision+1,updated_at=clock_timestamp() where receipt_id=r.receipt_id returning * into r;
 else
  insert into public.material_receipts(receipt_id,kind,raw_code,received_on,quantity,counted_qty,notes)
   values(p_request_id,'opening',p_raw_code,(clock_timestamp() at time zone 'Asia/Seoul')::date,p_counted_qty-v_base,p_counted_qty,coalesce(trim(p_note),'')) returning * into r;
 end if;
 return public.erp_request_done(p_request_id,'save_material_opening',p,to_jsonb(r));
end; $$;

-- New management tables are writable only through validated RPCs; old PC/table permissions are unchanged.
do $$ declare t text;f regprocedure;
begin
 foreach t in array array['sales_orders','material_receipts','inventory_movements','erp_requests','inventory_bootstrap'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  if t in('sales_orders','material_receipts','inventory_movements') then
   execute format('grant select on public.%I to anon,authenticated',t);
   execute format('drop policy if exists erp_read on public.%I',t);
   execute format('create policy erp_read on public.%I for select to anon,authenticated using(true)',t);
  end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
  'erp_stock_components','erp_lock_usage','erp_lock_receipt','erp_audit_material','erp_audit_finished','erp_request','erp_request_done','guard_sales_work_order',
  'save_sales_order','delete_sales_order','create_sales_work_order','save_material_receipt','void_material_receipt','save_material_opening') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  if f::text like '%erp_stock_components%' then execute format('grant execute on function %s to anon,authenticated',f);
  elsif f::text like '%save_sales_order%' or f::text like '%delete_sales_order%' or f::text like '%create_sales_work_order%' or f::text like '%save_material_receipt%' or f::text like '%void_material_receipt%' or f::text like '%save_material_opening%' then
   execute format('grant execute on function %s to authenticated',f);
   if has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE') then execute format('grant execute on function %s to anon',f);end if;
  end if;
 end loop;
end; $$;
grant select on public.material_inventory,public.finished_inventory_orders,public.finished_inventory,public.sales_order_progress to anon,authenticated;
notify pgrst,'reload schema';
commit;
