-- Apply AFTER routing_management.sql. Existing quantities and history are preserved.
begin;
do $$ begin
 if to_regclass('public.production_routings') is null then
  raise exception '먼저 routing_management.sql을 적용한 뒤 quality_management.sql을 실행하세요';
 end if;
end; $$;
alter table public.work_orders
 add column if not exists quality_quantities jsonb not null default '{}'::jsonb,
 add column if not exists scrap_qty numeric not null default 0,
 add column if not exists held_qty numeric not null default 0;

create table if not exists public.production_quality_events (
 event_id uuid primary key,
 wo_id text not null references public.work_orders(wo_id) on delete cascade,
 step integer not null check(step between 0 and 29),
 kind text not null check(kind in ('hold_available','hold_completed','rework','scrap','cancel','reversal')),
 quantity integer not null,
 defect_id uuid references public.production_quality_events(event_id) on delete cascade,
 reversal_of uuid unique references public.production_quality_events(event_id) on delete cascade,
 reason text not null default '' check(length(reason)<=100),
 note text not null default '' check(length(note)<=1000),
 created_at timestamptz not null default clock_timestamp(),
 check((kind in ('hold_available','hold_completed') and quantity>0 and defect_id is null and reversal_of is null and length(trim(reason))>0)
  or(kind in ('rework','scrap','cancel') and quantity>0 and defect_id is not null and reversal_of is null)
  or(kind='reversal' and quantity<0 and defect_id is not null and reversal_of is not null))
);
create index if not exists quality_events_order_time on public.production_quality_events(wo_id,created_at desc);
create index if not exists quality_events_defect on public.production_quality_events(defect_id);
alter table public.production_quality_events enable row level security;
revoke all on public.production_quality_events from public,anon,authenticated;
grant select on public.production_quality_events to anon,authenticated;
drop policy if exists quality_events_read on public.production_quality_events;
create policy quality_events_read on public.production_quality_events for select to anon,authenticated using(true);

create or replace view public.production_defects as
select h.event_id as defect_id,h.wo_id,h.step,
 case when h.kind='hold_completed' then 'completed' else 'available' end as source,
 h.quantity,h.reason,h.note,h.created_at,
 coalesce(a.reworked_qty,0) as reworked_qty,
 coalesce(a.scrapped_qty,0) as scrapped_qty,
 coalesce(a.cancelled_qty,0) as cancelled_qty,
 h.quantity-coalesce(a.reworked_qty,0)-coalesce(a.scrapped_qty,0)-coalesce(a.cancelled_qty,0) as held_qty,
 case when h.kind='hold_completed' then h.quantity-coalesce(a.cancelled_qty,0) else 0 end as completed_deduction
from public.production_quality_events h
left join lateral (
 select sum(e.quantity) filter(where coalesce(original.kind,e.kind)='rework') as reworked_qty,
 sum(e.quantity) filter(where coalesce(original.kind,e.kind)='scrap') as scrapped_qty,
 sum(e.quantity) filter(where coalesce(original.kind,e.kind)='cancel') as cancelled_qty
 from public.production_quality_events e
 left join public.production_quality_events original on original.event_id=e.reversal_of
 where e.defect_id=h.event_id
) a on true
where h.kind in ('hold_available','hold_completed');
revoke all on public.production_defects from public,anon,authenticated;
grant select on public.production_defects to anon,authenticated;

create or replace function public.guard_production_quantities()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_steps jsonb;
  v_step jsonb;
  v_route public.production_routings%rowtype;
  v_route_code text;
  v_previous numeric;
  v_scrap numeric := 0;
  v_held numeric := 0;
  v_step_held numeric;
  v_step_scrap numeric;
  v_deduct numeric;
  v_quality jsonb := '{}'::jsonb;
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
  if exists(select 1 from public.production_defects where wo_id=new.wo_id and (held_qty<0 or reworked_qty<0 or scrapped_qty<0 or cancelled_qty<0)) then
    raise exception '불량 건의 보류 잔량을 초과하거나 이미 사용된 처리를 취소할 수 없습니다';
  end if;
  select coalesce(sum(scrapped_qty),0),coalesce(sum(held_qty),0) into v_scrap,v_held from public.production_defects where wo_id=new.wo_id;
  v_previous := new.target_qty + v_scrap;
  v_steps := new.routing_steps;
  for i in 0..jsonb_array_length(v_steps)-1 loop
    v_step := v_steps->i;
    select coalesce(sum(quantity),0) into v_count from public.production_events where wo_id=new.wo_id and step=i;
    select coalesce(sum(held_qty),0),coalesce(sum(scrapped_qty),0),coalesce(sum(completed_deduction),0)
      into v_step_held,v_step_scrap,v_deduct from public.production_defects where wo_id=new.wo_id and step=i;
    v_count := v_count - v_deduct;
    if v_count < 0 or v_count + v_step_held + v_step_scrap > v_previous
       or (v_step->>'role'='shipment' and v_count>new.target_qty) then
      raise exception '% 양품·보류·폐기 수량이 앞 공정 수량 또는 목표 수량을 초과합니다. 후속 공정 기록부터 확인하세요', v_step->>'name';
    end if;
    v_counts := v_counts || jsonb_build_object(v_step->>'key', v_count);
    v_quality := v_quality || jsonb_build_object(v_step->>'key',jsonb_build_object('held',v_step_held,'scrapped',v_step_scrap,'completed_deduction',v_deduct));
    if v_count > 0 then
      v_status := case when v_step->>'role'='shipment' and v_count < new.target_qty then '부분출고'
        when v_count = new.target_qty then v_step->>'name' || '완료'
        else v_step->>'name' || '진행' end;
    end if;
    if v_step->>'role'='inspection' then v_inspected := v_count; end if;
    v_previous := v_count;
  end loop;
  new.process_quantities := v_counts;
  new.quality_quantities := v_quality;
  new.scrap_qty := v_scrap;
  new.held_qty := v_held;
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

-- All quality writes lock the same work-order row used by normal progress writes.
create or replace function public.apply_production_quality_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_order public.work_orders%rowtype;
 v_existing public.production_quality_events%rowtype;
 v_source public.production_quality_events%rowtype;
 v_id uuid := (p_event->>'event_id')::uuid;
 v_wo text := p_event->>'wo_id';
 v_kind text := p_event->>'kind';
 v_step integer := (p_event->>'step')::integer;
 v_qty integer := (p_event->>'quantity')::integer;
 v_defect uuid := (p_event->>'defect_id')::uuid;
 v_reversal uuid := (p_event->>'reversal_of')::uuid;
 v_reason text := trim(coalesce(p_event->>'reason',''));
 v_note text := trim(coalesce(p_event->>'note',''));
begin
 select * into v_order from public.work_orders where wo_id=v_wo for update;
 if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
 if not v_order.quantity_confirmed then raise exception '기존 작업의 누적 수량을 먼저 확인하세요'; end if;
 if v_id is null or v_kind is null or length(v_note)>1000 then raise exception '요청 번호와 메모를 확인하세요'; end if;
 if v_kind in ('hold_available','hold_completed') then
  if v_step is null or v_step<0 or v_step>=jsonb_array_length(v_order.routing_steps)
   or length(v_reason) not between 1 and 100 or v_defect is not null or v_reversal is not null then
   raise exception '공정과 불량 사유를 확인하세요';
  end if;
  if v_kind='hold_completed' and v_order.routing_steps->v_step->>'role'='shipment' then
   raise exception '이미 출고한 수량은 불량 등록으로 되돌릴 수 없습니다. 출고 기록 또는 반품을 확인하세요';
  end if;
 elsif v_kind in ('rework','scrap','cancel') then
  select * into v_source from public.production_quality_events
   where event_id=v_defect and wo_id=v_wo and kind in ('hold_available','hold_completed');
  if not found or v_reversal is not null then raise exception '처리할 불량 건을 찾을 수 없습니다'; end if;
  v_step := v_source.step; v_reason := '';
 elsif v_kind='reversal' then
  select * into v_source from public.production_quality_events
   where event_id=v_reversal and wo_id=v_wo and kind in ('rework','scrap','cancel');
  if not found then raise exception '취소할 불량 처리 이력을 찾을 수 없습니다'; end if;
  v_step := v_source.step;v_defect := v_source.defect_id;v_qty := -v_source.quantity;v_reason := '';
 else raise exception '불량 처리 구분을 확인하세요';
 end if;
 if v_qty is null or (v_kind<>'reversal' and v_qty<=0) then raise exception '불량 처리 수량은 1 이상의 정수로 입력하세요'; end if;
 select * into v_existing from public.production_quality_events where event_id=v_id;
 if found then
  if (v_existing.wo_id,v_existing.step,v_existing.kind,v_existing.quantity,v_existing.defect_id,v_existing.reversal_of,v_existing.reason,v_existing.note)
   is distinct from (v_wo,v_step,v_kind,v_qty,v_defect,v_reversal,v_reason,v_note) then
   raise exception '동일 요청 번호로 다른 불량 기록을 저장할 수 없습니다';
  end if;
 else
  insert into public.production_quality_events(event_id,wo_id,step,kind,quantity,defect_id,reversal_of,reason,note)
   values(v_id,v_wo,v_step,v_kind,v_qty,v_defect,v_reversal,v_reason,v_note);
 end if;
 select * into v_order from public.work_orders where wo_id=v_wo;
 return to_jsonb(v_order);
end;
$$;

create or replace function public.record_production_defect(
 p_wo_id text,p_step integer,p_quantity integer,p_source text,p_reason text,p_request_id uuid,p_note text default ''
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.apply_production_quality_event(jsonb_build_object('wo_id',p_wo_id,'step',p_step,'quantity',p_quantity,
 'kind',case p_source when 'available' then 'hold_available' when 'completed' then 'hold_completed' else 'invalid' end,
 'reason',p_reason,'event_id',p_request_id,'note',p_note));
$$;
create or replace function public.resolve_production_defect(
 p_wo_id text,p_defect_id uuid,p_kind text,p_quantity integer,p_request_id uuid,p_note text default ''
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.apply_production_quality_event(jsonb_build_object('wo_id',p_wo_id,'defect_id',p_defect_id,'quantity',p_quantity,
 'kind',case when p_kind in ('rework','scrap','cancel') then p_kind else 'invalid' end,'event_id',p_request_id,'note',p_note));
$$;
create or replace function public.reverse_production_quality(
 p_wo_id text,p_event_id uuid,p_request_id uuid,p_note text default ''
) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.apply_production_quality_event(jsonb_build_object('wo_id',p_wo_id,'reversal_of',p_event_id,
 'kind','reversal','event_id',p_request_id,'note',p_note));
$$;
drop trigger if exists refresh_quality_quantities on public.production_quality_events;
create trigger refresh_quality_quantities after insert on public.production_quality_events
for each row execute function public.refresh_production_quantities();

revoke all on function public.apply_production_quality_event(jsonb) from public,anon,authenticated;
revoke all on function public.record_production_defect(text,integer,integer,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.resolve_production_defect(text,uuid,text,integer,uuid,text) from public,anon,authenticated;
revoke all on function public.reverse_production_quality(text,uuid,uuid,text) from public,anon,authenticated;
-- Matches the existing public shop-floor quantity scanner.
grant execute on function public.record_production_defect(text,integer,integer,text,text,uuid,text),
 public.resolve_production_defect(text,uuid,text,integer,uuid,text),public.reverse_production_quality(text,uuid,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;

