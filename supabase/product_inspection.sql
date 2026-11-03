-- Apply after light_erp.sql. Existing scanner, quality and stock calculations are preserved.
begin;
alter table public.items add column if not exists product_details jsonb not null default '{}';
alter table public.items add column if not exists profile_revision integer not null default 1;
alter table public.sales_orders add column if not exists product_details jsonb not null default '{}';
alter table public.work_orders add column if not exists product_details jsonb not null default '{}';
alter table public.work_orders add column if not exists details_revision integer not null default 1;

create or replace function public.validate_product_details(p jsonb) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare k text;v jsonb;r jsonb:='{}';
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception '제품정보 형식을 확인하세요';end if;
 for k,v in select * from jsonb_each(p) loop
  if k not in('po_no','po_line','item_name','size','material','specification','classification','drawing_no','extra') or jsonb_typeof(v)<>'string'
   or length(v#>>'{}')>(case when k='extra' then 2000 when k='specification' then 300 else 200 end) then raise exception '제품정보 항목과 길이를 확인하세요';end if;
  r:=r||jsonb_build_object(k,trim(v#>>'{}'));
 end loop;return r;
end; $$;
-- Capture known names/materials once; never infer PO, dimensions or certification.
create table if not exists public.product_inspection_bootstrap(singleton boolean primary key default true check(singleton));
revoke all on public.product_inspection_bootstrap from public,anon,authenticated;
do $$ declare first_run boolean;begin
insert into public.product_inspection_bootstrap values(true) on conflict do nothing returning singleton into first_run;
if first_run then
update public.items i set product_details=jsonb_build_object('material',coalesce(to_jsonb(i)->>'material','')) where product_details='{}';
update public.work_orders w set product_details=i.product_details||jsonb_build_object('item_name',i.item_name,'material',coalesce(nullif(w.casting_material,''),i.product_details->>'material','')) from public.items i where i.item_code=w.item_code and w.product_details='{}';
update public.sales_orders s set product_details=i.product_details||jsonb_build_object('item_name',i.item_name) from public.items i where i.item_code=s.item_code and s.product_details='{}';
end if;end; $$;

create or replace view public.sales_order_progress with(security_invoker=true) as
with q as(select w.order_id,count(*) as work_order_count,sum(w.target_qty) as allocated_qty,
 sum(case when w.quantity_confirmed then c.shipped else 0 end) as shipped_qty,count(*) filter(where not w.quantity_confirmed) as unconfirmed_count,
 jsonb_agg(jsonb_build_object('wo_id',w.wo_id,'current_step',w.current_step,'target_qty',w.target_qty,'shipped_qty',case when w.quantity_confirmed then c.shipped end,'quantity_confirmed',w.quantity_confirmed) order by w.wo_id) as work_orders
 from public.work_orders w cross join lateral public.erp_stock_components(to_jsonb(w)) c where w.order_id is not null group by w.order_id)
select s.order_id,s.order_no,s.client_code,s.item_code,s.quantity,s.unit_price,s.amount,s.due_date,s.notes,s.revision,s.created_at,s.updated_at,
 coalesce(q.work_order_count,0) as work_order_count,coalesce(q.allocated_qty,0) as allocated_qty,s.quantity-coalesce(q.allocated_qty,0) as unallocated_qty,
 coalesce(q.shipped_qty,0) as shipped_qty,s.quantity-coalesce(q.shipped_qty,0) as remaining_qty,coalesce(q.unconfirmed_count,0) as unconfirmed_count,
 case when coalesce(q.unconfirmed_count,0)>0 then '수량 확인 필요' when coalesce(q.shipped_qty,0)>=s.quantity then '출하 완료' when coalesce(q.shipped_qty,0)>0 then '부분 출하' when coalesce(q.allocated_qty,0)>0 then '작업 진행' else '수주 등록' end as status,
 coalesce(q.work_orders,'[]'::jsonb) as work_orders,s.product_details
from public.sales_orders s left join q using(order_id);

create or replace function public.save_item_profile(p_data jsonb,p_create boolean,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('data',p_data,'create',p_create,'revision',p_expected_revision);c jsonb;r public.items%rowtype;d jsonb:=public.validate_product_details(p_data->'product_details');
begin
 c:=public.erp_request(p_request_id,'save_item_profile',p);if c is not null then return c;end if;
 if p_create is null or coalesce(length(trim(p_data->>'item_code')),0) not between 1 and 80 or coalesce(length(trim(p_data->>'item_name')),0) not between 1 and 200 then raise exception '품목 코드·품명을 확인하세요';end if;
 if p_create then perform public.create_production_master('item',trim(p_data->>'item_code'),trim(p_data->>'item_name'));
 else select * into r from public.items where item_code=p_data->>'item_code' for update;
  if not found or r.profile_revision is distinct from p_expected_revision then raise exception '품목이 변경되었습니다. 다시 조회하세요';end if;
 end if;
 update public.items set item_name=trim(p_data->>'item_name'),product_details=d-'po_no'-'po_line'-'item_name',profile_revision=profile_revision+1 where item_code=trim(p_data->>'item_code') returning * into r;
 return public.erp_request_done(p_request_id,'save_item_profile',p,to_jsonb(r));
end; $$;
create or replace function public.save_detailed_sales_order(p_data jsonb,p_create boolean,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('data',p_data,'create',p_create,'revision',p_expected_revision);c jsonb;r jsonb;d jsonb:=public.validate_product_details(p_data->'product_details');
begin
 c:=public.erp_request(p_request_id,'save_detailed_sales_order',p);if c is not null then return c;end if;
 r:=public.save_sales_order(p_data,p_create,p_expected_revision,gen_random_uuid());
 update public.sales_orders set product_details=d where order_id=(r->>'order_id')::uuid returning to_jsonb(sales_orders) into r;
 return public.erp_request_done(p_request_id,'save_detailed_sales_order',p,r);
end; $$;
create or replace function public.save_detailed_work_order(p_order jsonb,p_materials jsonb,p_create boolean,p_original_usage_ids jsonb,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('order',p_order,'materials',p_materials,'create',p_create,'usage',p_original_usage_ids,'revision',p_expected_revision);c jsonb;r public.work_orders%rowtype;d jsonb:=public.validate_product_details(p_order->'product_details');
begin
 c:=public.erp_request(p_request_id,'save_detailed_work_order',p);if c is not null then return c;end if;
 if not p_create then select * into r from public.work_orders where wo_id=trim(p_order->>'wo_id') for update;
  if not found or r.details_revision is distinct from p_expected_revision then raise exception '작업지시가 변경되었습니다. 다시 열어 주세요';end if;
 end if;
 perform public.save_routed_production_order(p_order||jsonb_build_object('casting_material',coalesce(d->>'material','')),p_materials,p_create,p_original_usage_ids);
 update public.work_orders set product_details=d,details_revision=details_revision+1 where wo_id=trim(p_order->>'wo_id') returning * into r;
 return public.erp_request_done(p_request_id,'save_detailed_work_order',p,to_jsonb(r));
end; $$;
create or replace function public.create_detailed_sales_work_order(p_order_id uuid,p_expected_revision integer,p_order jsonb,p_materials jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('id',p_order_id,'revision',p_expected_revision,'order',p_order,'materials',p_materials);c jsonb;r jsonb;d jsonb;
begin
 c:=public.erp_request(p_request_id,'create_detailed_sales_work_order',p);if c is not null then return c;end if;
 select product_details into d from public.sales_orders where order_id=p_order_id for update;
 r:=public.create_sales_work_order(p_order_id,p_expected_revision,p_order||jsonb_build_object('casting_material',coalesce(d->>'material','')),p_materials,gen_random_uuid());
 update public.work_orders set product_details=d where wo_id=r->>'wo_id' returning to_jsonb(work_orders) into r;
 return public.erp_request_done(p_request_id,'create_detailed_sales_work_order',p,r);
end; $$;

create table if not exists public.inspection_reports(
 report_id uuid primary key,report_no text not null unique check(length(report_no) between 1 and 80),
 wo_id text not null references public.work_orders(wo_id) on delete restrict,
 status text not null default 'draft' check(status in('draft','issued','void')),
 judgement text not null default 'pending' check(judgement in('pending','pass','fail')),
 document jsonb not null,revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),issued_at timestamptz,void_reason text
);
create index if not exists inspection_reports_work_order on public.inspection_reports(wo_id);
create table if not exists public.inspection_report_history(
 history_id bigint generated always as identity primary key,report_id uuid not null references public.inspection_reports(report_id),
 revision integer not null,status text not null,snapshot jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create or replace function public.audit_inspection_report() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.inspection_report_history(report_id,revision,status,snapshot) values(new.report_id,new.revision,new.status,to_jsonb(new));return null;end; $$;
drop trigger if exists audit_inspection_report on public.inspection_reports;
create trigger audit_inspection_report after insert or update on public.inspection_reports for each row execute function public.audit_inspection_report();

create or replace function public.save_inspection_report(p_data jsonb,p_expected_revision integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('data',p_data,'revision',p_expected_revision);c jsonb;r public.inspection_reports%rowtype;w public.work_orders%rowtype;
 v_id uuid:=coalesce(nullif(p_data->>'report_id','')::uuid,p_request_id);d jsonb:=p_data->'document';t jsonb;k text;v_qty numeric;v_lot numeric;v_product jsonb;
begin
 c:=public.erp_request(p_request_id,'save_inspection_report',p);if c is not null then return c;end if;
 if coalesce(length(trim(p_data->>'report_no')),0) not between 1 and 80 or jsonb_typeof(d) is distinct from 'object' then raise exception '성적서 번호와 내용을 확인하세요';end if;
 select * into r from public.inspection_reports where report_id=v_id for update;
 if found then
  if r.status<>'draft' then raise exception '발행·취소된 성적서는 수정할 수 없습니다. 새 번호로 작성하세요';end if;
  if r.revision is distinct from p_expected_revision then raise exception '성적서가 변경되었습니다. 다시 열어 주세요';end if;
  if r.wo_id is distinct from p_data->>'wo_id' then raise exception '성적서의 작업지시는 변경할 수 없습니다';end if;
 elsif p_expected_revision is not null then raise exception '수정할 성적서가 없습니다';end if;
 select * into w from public.work_orders where wo_id=p_data->>'wo_id' for update;
 if not found then raise exception '작업지시를 찾을 수 없습니다';end if;
 if jsonb_typeof(d->'tests') is distinct from 'array' or jsonb_array_length(d->'tests') not between 1 and 100 then raise exception '검사 항목은 1~100개로 등록하세요';end if;
 for t in select * from jsonb_array_elements(d->'tests') loop
  if jsonb_typeof(t) is distinct from 'object' or coalesce(t->>'group','') not in('visual','dimension','chemical','mechanical','ndt','other') or coalesce(t->>'judgement','') not in('pending','pass','fail','na') then raise exception '검사 항목 구분과 판정을 확인하세요';end if;
  foreach k in array array['name','standard','method','unit','result','remark'] loop
   if jsonb_typeof(t->k) is distinct from 'string' or length(t->>k)>500 then raise exception '검사 항목의 입력 형식·길이를 확인하세요';end if;
  end loop;
 end loop;
 foreach k in array array['manufacturer','manufacturer_address','inspector','reviewer','external_ref','remarks'] loop
  if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>(case when k='remarks' then 2000 else 300 end) then raise exception '성적서 기본정보 형식·길이를 확인하세요';end if;
 end loop;
 if nullif(d->>'inspected_on','') is null or nullif(d->>'issued_on','') is null or (d->>'inspected_on')::date>(d->>'issued_on')::date then raise exception '검사일과 발행일을 확인하세요';end if;
 v_qty:=(d->>'inspection_qty')::numeric;v_lot:=(d->>'lot_qty')::numeric;
 if v_qty is null or v_lot is null or v_qty::text in('NaN','Infinity','-Infinity') or v_lot::text in('NaN','Infinity','-Infinity') or v_qty<1 or v_qty<>trunc(v_qty) or v_lot<v_qty or v_lot<>trunc(v_lot) or v_lot>w.target_qty then raise exception '검사수량 ≤ 대상 로트수량 ≤ 작업지시 목표수량의 정수로 입력하세요';end if;
 select w.product_details||jsonb_build_object('item_code',w.item_code,'item_name',coalesce(nullif(w.product_details->>'item_name',''),i.item_name),'client_code',w.client_code,'client_name',cl.client_name,'heat_no',w.heat_no,'target_qty',w.target_qty,'routing_name',w.routing_name) into v_product from public.items i join public.clients cl on cl.client_code=w.client_code where i.item_code=w.item_code;
 d:=jsonb_build_object('manufacturer',d->>'manufacturer','manufacturer_address',d->>'manufacturer_address','inspector',d->>'inspector','reviewer',d->>'reviewer','external_ref',d->>'external_ref','remarks',d->>'remarks','inspected_on',(d->>'inspected_on')::date,'issued_on',(d->>'issued_on')::date,'inspection_qty',v_qty,'lot_qty',v_lot,'tests',d->'tests','product',v_product);
 if r.report_id is null then insert into public.inspection_reports(report_id,report_no,wo_id,document) values(v_id,trim(p_data->>'report_no'),w.wo_id,d) returning * into r;
 else update public.inspection_reports set report_no=trim(p_data->>'report_no'),document=d,revision=revision+1,updated_at=clock_timestamp() where report_id=v_id returning * into r;end if;
 return public.erp_request_done(p_request_id,'save_inspection_report',p,to_jsonb(r));
end; $$;
create or replace function public.set_inspection_status(p_report_id uuid,p_expected_revision integer,p_status text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('id',p_report_id,'revision',p_expected_revision,'status',p_status,'reason',p_reason);c jsonb;r public.inspection_reports%rowtype;d jsonb;t jsonb;v_result text:='pass';v_count integer:=0;
begin
 c:=public.erp_request(p_request_id,'set_inspection_status',p);if c is not null then return c;end if;
 select * into r from public.inspection_reports where report_id=p_report_id for update;
 if not found or r.revision is distinct from p_expected_revision then raise exception '성적서가 변경되었습니다. 다시 조회하세요';end if;
 if r.status='void' or p_status not in('issued','void') or p_status is null then raise exception '변경할 수 없는 성적서 상태입니다';end if;
 if p_status='issued' then
  if r.status<>'draft' then raise exception '이미 발행된 성적서입니다';end if;d:=r.document;
  if trim(d->>'manufacturer')='' or trim(d->>'inspector')='' or trim(d->>'reviewer')='' then raise exception '제조사·검사자·확인자를 입력하고 초안을 저장하세요';end if;
  for t in select * from jsonb_array_elements(d->'tests') loop
   if trim(t->>'name')='' or trim(t->>'standard')='' or trim(t->>'result')='' or t->>'judgement'='pending' or (t->>'judgement'='na' and trim(t->>'remark')='') then raise exception '모든 항목의 검사명·기준·결과·판정을 완료하세요. 해당 없음은 사유도 필요합니다';end if;
   if t->>'judgement'<>'na' then v_count:=v_count+1;end if;
   if t->>'judgement'='fail' then v_result:='fail';end if;
  end loop;
  if v_count=0 then raise exception '실제 판정한 검사 항목이 필요합니다';end if;
 else
  if coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception '취소 사유를 입력하세요';end if;v_result:=r.judgement;
 end if;
 update public.inspection_reports set status=p_status,judgement=v_result,revision=revision+1,updated_at=clock_timestamp(),issued_at=case when p_status='issued' then clock_timestamp() else issued_at end,void_reason=case when p_status='void' then trim(p_reason) end where report_id=p_report_id returning * into r;
 return public.erp_request_done(p_request_id,'set_inspection_status',p,to_jsonb(r));
end; $$;

do $$ declare t text;f regprocedure;begin
 foreach t in array array['inspection_reports','inspection_report_history'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to anon,authenticated',t);execute format('drop policy if exists inspection_read on public.%I',t);
  execute format('create policy inspection_read on public.%I for select to anon,authenticated using(true)',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('validate_product_details','audit_inspection_report','save_item_profile','save_detailed_sales_order','save_detailed_work_order','create_detailed_sales_work_order','save_inspection_report','set_inspection_status') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  if f::text not like '%validate_product_details%' and f::text not like '%audit_inspection_report%' then
   execute format('grant execute on function %s to authenticated',f);
   if has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE') then execute format('grant execute on function %s to anon',f);end if;
  end if;
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
