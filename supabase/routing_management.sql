-- Apply after partial_production.sql. Safe to re-run: existing routes and order snapshots are retained.
begin;
create table if not exists public.production_routings (
 routing_code text primary key,
 routing_name text not null,
 description text not null default '',
 steps jsonb not null,
 is_active boolean not null default true,
 revision integer not null default 1
);
insert into public.production_routings(routing_code,routing_name,description,steps) values
 ('LEGACY','기존 6공정','기존 작업과 이전 프로그램의 호환용 라우팅','[{"key":"조형","name":"조형","place":"조형장","role":"production"},{"key":"주입","name":"주입","place":"주입장","role":"production"},{"key":"가공","name":"가공","place":"가공장","role":"production"},{"key":"검사","name":"검사","place":"검사장","role":"inspection"},{"key":"포장","name":"포장","place":"포장장","role":"production"},{"key":"출고","name":"출고","place":"출고장","role":"shipment"}]'),
 ('CAST','주물 제작','현장 설비 기준 기본안. 작업 방법에 따라 공정을 조정하세요. 용접보수·가공은 필요한 라우팅에 추가합니다.','[{"key":"molding","name":"조형·중자","place":"조형장","role":"production"},{"key":"pouring","name":"용해·주입","place":"용해로·주입장","role":"production"},{"key":"shakeout","name":"냉각·해체","place":"해체장","role":"production"},{"key":"shot","name":"쇼트","place":"쇼트기","role":"production"},{"key":"finishing","name":"절단·사상","place":"절단장·사상장","role":"production"},{"key":"inspection","name":"검사","place":"검사장","role":"inspection"},{"key":"packing","name":"포장","place":"출고장","role":"production"},{"key":"shipping","name":"출고","place":"출고장","role":"shipment"}]'),
 ('TRADE','완제품 매입·납품','완제품을 매입해 검사 후 납품하는 흐름','[{"key":"receipt","name":"매입 입고","place":"입고장","role":"production"},{"key":"receipt_inspection","name":"입고검사","place":"검사장","role":"inspection"},{"key":"packing","name":"포장","place":"출고장","role":"production"},{"key":"shipping","name":"출고","place":"출고장","role":"shipment"}]')
on conflict (routing_code) do nothing;
alter table public.production_routings enable row level security;
revoke all on public.production_routings from public,anon,authenticated;
grant select on public.production_routings to anon,authenticated;
drop policy if exists production_routings_read on public.production_routings;
create policy production_routings_read on public.production_routings for select to anon,authenticated using(true);
-- Column defaults freeze the ORIGINAL six stages for every pre-existing work order.
alter table public.work_orders
 add column if not exists routing_code text not null default 'LEGACY' references public.production_routings(routing_code),
 add column if not exists routing_name text not null default '기존 6공정',
 add column if not exists routing_steps jsonb not null default '[{"key":"조형","name":"조형","place":"조형장","role":"production"},{"key":"주입","name":"주입","place":"주입장","role":"production"},{"key":"가공","name":"가공","place":"가공장","role":"production"},{"key":"검사","name":"검사","place":"검사장","role":"inspection"},{"key":"포장","name":"포장","place":"포장장","role":"production"},{"key":"출고","name":"출고","place":"출고장","role":"shipment"}]'::jsonb;
alter table public.production_events drop constraint if exists production_events_step_check;
alter table public.production_events add constraint production_events_step_check check(step between 0 and 29);

create or replace function public.check_routing_manager()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE')
 and (auth.uid() is null or not exists(select 1 from public.production_admins where user_id=auth.uid())) then
   raise exception '관리자 권한이 필요합니다' using errcode='42501';
 end if;
end;
$$;

create or replace function public.save_production_routing(p_route jsonb,p_create boolean,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_code text := trim(p_route->>'routing_code');
 v_name text := trim(p_route->>'routing_name');
 v_steps jsonb := p_route->'steps';
 v_step jsonb;
 v_row public.production_routings%rowtype;
 v_keys text[] := array[]::text[];
 v_names text[] := array[]::text[];
 v_index integer := 0;
begin
 perform public.check_routing_manager();
 perform pg_advisory_xact_lock(748219);
 if p_create is null or v_code is null or v_code !~ '^[A-Za-z0-9_-]{1,40}$'
 or v_name is null or length(v_name) not between 1 and 100
 or length(coalesce(p_route->>'description',''))>1000
 or jsonb_typeof(p_route->'is_active') is distinct from 'boolean' then raise exception '라우팅 코드·이름·상태를 확인하세요'; end if;
 if jsonb_typeof(v_steps) is distinct from 'array' then raise exception '공정을 등록하세요'; end if;
 if jsonb_array_length(v_steps) not between 1 and 30 then raise exception '공정은 1~30개로 구성하세요'; end if;
 for v_step in select value from jsonb_array_elements(v_steps) loop
   if jsonb_typeof(v_step) is distinct from 'object'
   or jsonb_typeof(v_step->'name') is distinct from 'string'
   or jsonb_typeof(v_step->'key') is distinct from 'string'
   or jsonb_typeof(v_step->'place') is distinct from 'string'
   or jsonb_typeof(v_step->'role') is distinct from 'string'
   or coalesce(length(trim(v_step->>'name')),0) not between 1 and 60
   or coalesce(length(v_step->>'key'),0) not between 1 and 80
   or length(coalesce(v_step->>'place',''))>100
   or coalesce(v_step->>'role','') not in ('production','inspection','shipment')
   then raise exception '공정 이름·작업장·구분을 확인하세요'; end if;
   if v_step->>'key'=any(v_keys) or trim(v_step->>'name')=any(v_names) then raise exception '같은 공정을 중복 등록할 수 없습니다'; end if;
   if (v_step->>'role'='shipment') is distinct from (v_index=jsonb_array_length(v_steps)-1) then
     raise exception '출고 공정은 마지막에 한 번만 배치하세요';
   end if;
   v_keys := array_append(v_keys,v_step->>'key');
   v_names := array_append(v_names,trim(v_step->>'name'));
   v_index := v_index+1;
 end loop;
 if p_create then
   insert into public.production_routings(routing_code,routing_name,steps) values(v_code,v_name,v_steps);
 else
   select * into v_row from public.production_routings where routing_code=v_code for update;
   if not found then raise exception '라우팅을 찾을 수 없습니다'; end if;
   if v_row.revision is distinct from p_expected_revision then raise exception '다른 사용자가 수정했습니다. 새로고침 후 다시 열어 주세요'; end if;
 end if;
 update public.production_routings set routing_name=v_name,description=coalesce(p_route->>'description',''),
 steps=v_steps,is_active=(p_route->>'is_active')::boolean,revision=revision+1
 where routing_code=v_code returning * into v_row;
 return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_production_routing(p_code text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.production_routings%rowtype;
begin
 perform public.check_routing_manager();
 perform pg_advisory_xact_lock(748219);
 select * into v_row from public.production_routings where routing_code=p_code for update;
 if not found then raise exception '라우팅을 찾을 수 없습니다'; end if;
 if v_row.revision is distinct from p_expected_revision then raise exception '다른 사용자가 수정했습니다. 새로고침 후 다시 열어 주세요'; end if;
 if p_code='LEGACY' or exists(select 1 from public.work_orders where routing_code=p_code) then
   update public.production_routings set is_active=false,revision=revision+1 where routing_code=p_code;
   return jsonb_build_object('archived',true);
 end if;
 delete from public.production_routings where routing_code=p_code;
 return jsonb_build_object('archived',false);
end;
$$;

create or replace function public.guard_production_quantities()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_steps jsonb;
  v_step jsonb;
  v_route public.production_routings%rowtype;
  v_route_code text;
  v_previous numeric := new.target_qty;
  v_count numeric;
  v_counts jsonb := '{}'::jsonb;
  v_status text := '발행대기';
  v_inspected numeric := 0;
  v_initializing boolean := coalesce(nullif(current_setting('app.production_initializing', true), '') = new.wo_id, false);
begin
  if new.target_qty is null or new.target_qty::text in ('NaN','Infinity','-Infinity')
     or new.target_qty <= 0 or new.target_qty <> trunc(new.target_qty) or new.target_qty > 2147483647 then
    raise exception '목표 수량은 1 이상의 정수로 입력하세요';
  end if;
  if tg_op = 'INSERT' then
    new.quantity_confirmed := true;
    new.initialization_id := null;
    v_route_code := coalesce(nullif(current_setting('app.new_order_routing',true),''), new.routing_code, 'LEGACY');
    select * into v_route from public.production_routings where routing_code=v_route_code for share;
    if not found or not v_route.is_active then raise exception '사용 가능한 라우팅을 선택하세요'; end if;
    new.routing_code := v_route.routing_code;
    new.routing_name := v_route.routing_name;
    new.routing_steps := v_route.steps;
  else
    if new.routing_code is distinct from old.routing_code or new.routing_name is distinct from old.routing_name
      or new.routing_steps is distinct from old.routing_steps then
      raise exception '발행된 작업지시의 라우팅은 변경할 수 없습니다. 새 작업지시를 등록하세요';
    end if;
    if new.wo_id is distinct from old.wo_id then raise exception '작업지시 번호는 변경할 수 없습니다'; end if;
    if new.quantity_confirmed is distinct from old.quantity_confirmed
       or new.initialization_id is distinct from old.initialization_id then
      if not v_initializing or old.quantity_confirmed or not new.quantity_confirmed or new.initialization_id is null then
        raise exception '기존 수량 확인 기능으로 누적 수량을 등록하세요';
      end if;
    end if;
  end if;
  v_steps := new.routing_steps;
  for i in 0..jsonb_array_length(v_steps)-1 loop
    v_step := v_steps->i;
    select coalesce(sum(quantity),0) into v_count from public.production_events where wo_id=new.wo_id and step=i;
    if v_count < 0 or v_count > v_previous then
      raise exception '% 수량이 앞 공정 완료 수량 또는 목표 수량을 초과합니다. 후속 공정 기록부터 확인하세요', v_step->>'name';
    end if;
    v_counts := v_counts || jsonb_build_object(v_step->>'key', v_count);
    if v_count > 0 then
      v_status := case when v_step->>'role'='shipment' and v_count < new.target_qty then '부분출고'
        when v_count = new.target_qty then v_step->>'name' || '완료'
        else v_step->>'name' || '진행' end;
    end if;
    if v_step->>'role'='inspection' then v_inspected := v_count; end if;
    v_previous := v_count;
  end loop;
  new.process_quantities := v_counts;
  if tg_op = 'UPDATE' and new.current_step is distinct from old.current_step and new.current_step is distinct from v_status then
    raise exception '상태만 변경할 수 없습니다. 현장 스캐너에서 처리 수량을 기록하세요';
  end if;
  if new.quantity_confirmed then
    new.current_step := v_status;
    new.actual_qty := v_inspected;
  end if;
  return new;
end;
$$;

create or replace function public.record_production_progress(
  p_wo_id text, p_step integer, p_quantity integer, p_request_id uuid, p_note text default ''
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.work_orders%rowtype;
  v_event public.production_events%rowtype;
begin
  select * into v_order from public.work_orders where wo_id=p_wo_id for update;
  if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
  if not v_order.quantity_confirmed then raise exception '기존 작업의 누적 완료 수량을 먼저 확인하세요'; end if;
  if p_request_id is null or p_step is null or (p_step < 0 or p_step >= jsonb_array_length(v_order.routing_steps)) or p_quantity is null or p_quantity <= 0
    or length(coalesce(p_note,'')) > 500 then raise exception '공정과 처리 수량을 확인하세요'; end if;
  select * into v_event from public.production_events where event_id=p_request_id;
  if found then
    if v_event.wo_id <> p_wo_id or v_event.step <> p_step or v_event.quantity <> p_quantity
       or v_event.kind <> 'completion' or v_event.note <> coalesce(p_note,'') then
      raise exception '동일 요청 번호로 다른 실적을 기록할 수 없습니다';
    end if;
  else
    insert into public.production_events(event_id,wo_id,step,quantity,note)
    values(p_request_id,p_wo_id,p_step,p_quantity,coalesce(p_note,''));
  end if;
  select * into v_order from public.work_orders where wo_id=p_wo_id;
  return to_jsonb(v_order);
end;
$$;

create or replace function public.initialize_production_quantities(p_wo_id text, p_quantities jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.work_orders%rowtype;
  v_steps jsonb;
  v_previous numeric;
  v_count numeric;
begin
  select * into v_order from public.work_orders where wo_id=p_wo_id for update;
  if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
  if p_request_id is null then raise exception '요청 번호가 필요합니다'; end if;
  v_steps := v_order.routing_steps;
  if v_order.quantity_confirmed then
    if v_order.initialization_id = p_request_id then
      for i in 0..jsonb_array_length(v_steps)-1 loop
        select coalesce(sum(quantity),0) into v_count from public.production_events
          where wo_id=p_wo_id and step=i and kind='opening';
        if p_quantities->(v_steps->i->>'key') is distinct from to_jsonb(v_count) then
          raise exception '동일 요청 번호로 다른 누적 수량을 등록할 수 없습니다';
        end if;
      end loop;
      return to_jsonb(v_order);
    end if;
    raise exception '이미 수량 확인이 완료되었습니다. 새로고침하세요';
  end if;
  if jsonb_typeof(p_quantities) is distinct from 'object' then raise exception '공정별 누적 수량을 입력하세요'; end if;
  v_previous := v_order.target_qty;
  -- Validate the whole opening before inserting; temporary aggregates cannot violate ordering.
  for i in 0..jsonb_array_length(v_steps)-1 loop
    if jsonb_typeof(p_quantities->(v_steps->i->>'key')) is distinct from 'number' then
      raise exception '% 누적 수량을 입력하세요', (v_steps->i->>'key');
    end if;
    v_count := (p_quantities->>(v_steps->i->>'key'))::numeric;
    if v_count < 0 or v_count <> trunc(v_count) or v_count > v_previous then
      raise exception '% 누적 수량은 0~%개로 입력하세요', (v_steps->i->>'key'), v_previous;
    end if;
    v_previous := v_count;
  end loop;
  for i in 0..jsonb_array_length(v_steps)-1 loop
    v_count := (p_quantities->>(v_steps->i->>'key'))::numeric;
    if v_count > 0 then
      insert into public.production_events(wo_id,step,quantity,kind,note)
      values(p_wo_id,i,v_count::integer,'opening','기존 작업 누적 수량 확인');
    end if;
  end loop;
  perform set_config('app.production_initializing', p_wo_id, true);
  update public.work_orders set quantity_confirmed=true, initialization_id=p_request_id where wo_id=p_wo_id returning * into v_order;
  perform set_config('app.production_initializing', '', true);
  return to_jsonb(v_order);
end;
$$;

-- Reuse the existing order/material validation and permissions, setting routing only on INSERT.
create or replace function public.save_routed_production_order(p_order jsonb,p_materials jsonb,p_create boolean,p_original_usage_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 perform public.check_routing_manager();
 if p_create then
   if coalesce(trim(p_order->>'routing_code'),'')='' then raise exception '라우팅을 선택하세요'; end if;
   perform set_config('app.new_order_routing',p_order->>'routing_code',true);
 end if;
 perform public.save_production_order(p_order,p_materials,p_create,p_original_usage_ids);
 select to_jsonb(w) into v_result from public.work_orders w where wo_id=trim(p_order->>'wo_id');
 perform set_config('app.new_order_routing','',true);
 return v_result;
end;
$$;

revoke all on function public.check_routing_manager() from public,anon,authenticated;
revoke all on function public.save_production_routing(jsonb,boolean,integer) from public,anon,authenticated;
revoke all on function public.delete_production_routing(text,integer) from public,anon,authenticated;
revoke all on function public.save_routed_production_order(jsonb,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_production_routing(jsonb,boolean,integer),
 public.delete_production_routing(text,integer),public.save_routed_production_order(jsonb,jsonb,boolean,jsonb) to authenticated;
do $$ begin
 if has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE') then
  grant execute on function public.save_production_routing(jsonb,boolean,integer),
   public.delete_production_routing(text,integer),public.save_routed_production_order(jsonb,jsonb,boolean,jsonb) to anon;
 end if;
end; $$;
notify pgrst,'reload schema';
commit;

