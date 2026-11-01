-- Apply after production_management.sql and (if used) anonymous_management.sql.
-- Existing progressed orders require an explicit opening count; no quantities are guessed.
begin;

alter table public.work_orders
  add column if not exists process_quantities jsonb,
  add column if not exists quantity_confirmed boolean not null default false,
  add column if not exists initialization_id uuid;

update public.work_orders
set process_quantities = '{}'::jsonb,
    quantity_confirmed = coalesce(current_step, '') in ('', '발행대기')
where process_quantities is null;

alter table public.work_orders
  alter column process_quantities set default '{}'::jsonb,
  alter column process_quantities set not null,
  alter column quantity_confirmed set default true;

create table if not exists public.production_events (
  event_id uuid primary key default gen_random_uuid(),
  wo_id text not null references public.work_orders(wo_id) on delete cascade,
  step integer not null check (step between 0 and 5),
  quantity integer not null,
  kind text not null default 'completion' check (kind in ('completion', 'opening', 'reversal')),
  reversal_of uuid unique references public.production_events(event_id),
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind in ('completion', 'opening') and quantity > 0 and reversal_of is null)
    or (kind = 'reversal' and quantity < 0 and reversal_of is not null))
);
create index if not exists production_events_order_time on public.production_events (wo_id, created_at desc);
alter table public.production_events enable row level security;
revoke all on public.production_events from public, anon, authenticated;
grant select on public.production_events to anon, authenticated;
drop policy if exists production_events_read on public.production_events;
create policy production_events_read on public.production_events for select to anon, authenticated using (true);

-- This guard also covers target edits and old clients trying to overwrite a single status.
-- Quantities are always recomputed from the immutable ledger, never trusted from a client.
create or replace function public.guard_production_quantities()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_names text[] := array['조형','주입','가공','검사','포장','출고'];
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
  else
    if new.wo_id is distinct from old.wo_id then raise exception '작업지시 번호는 변경할 수 없습니다'; end if;
    if new.quantity_confirmed is distinct from old.quantity_confirmed
       or new.initialization_id is distinct from old.initialization_id then
      if not v_initializing or old.quantity_confirmed or not new.quantity_confirmed or new.initialization_id is null then
        raise exception '기존 수량 확인 기능으로 누적 수량을 등록하세요';
      end if;
    end if;
  end if;
  for i in 0..5 loop
    select coalesce(sum(quantity),0) into v_count from public.production_events where wo_id=new.wo_id and step=i;
    if v_count < 0 or v_count > v_previous then
      raise exception '% 수량이 앞 공정 완료 수량 또는 목표 수량을 초과합니다. 후속 공정 기록부터 확인하세요', v_names[i+1];
    end if;
    v_counts := v_counts || jsonb_build_object(v_names[i+1], v_count);
    if v_count > 0 then
      v_status := case when i=5 and v_count < new.target_qty then '부분출고'
        when v_count = new.target_qty then v_names[i+1] || '완료'
        else v_names[i+1] || '진행' end;
    end if;
    if i=3 then v_inspected := v_count; end if;
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
drop trigger if exists guard_production_quantities on public.work_orders;
create trigger guard_production_quantities before insert or update on public.work_orders
for each row execute function public.guard_production_quantities();

create or replace function public.refresh_production_quantities()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.work_orders set process_quantities=process_quantities where wo_id=new.wo_id;
  return new;
end;
$$;
drop trigger if exists refresh_production_quantities on public.production_events;
create trigger refresh_production_quantities after insert on public.production_events
for each row execute function public.refresh_production_quantities();

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
  if p_request_id is null or p_step is null or p_step not between 0 and 5 or p_quantity is null or p_quantity <= 0
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
  v_names text[] := array['조형','주입','가공','검사','포장','출고'];
  v_previous numeric;
  v_count numeric;
begin
  select * into v_order from public.work_orders where wo_id=p_wo_id for update;
  if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
  if p_request_id is null then raise exception '요청 번호가 필요합니다'; end if;
  if v_order.quantity_confirmed then
    if v_order.initialization_id = p_request_id then
      for i in 0..5 loop
        select coalesce(sum(quantity),0) into v_count from public.production_events
          where wo_id=p_wo_id and step=i and kind='opening';
        if p_quantities->v_names[i+1] is distinct from to_jsonb(v_count) then
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
  for i in 0..5 loop
    if jsonb_typeof(p_quantities->v_names[i+1]) is distinct from 'number' then
      raise exception '% 누적 수량을 입력하세요', v_names[i+1];
    end if;
    v_count := (p_quantities->>v_names[i+1])::numeric;
    if v_count < 0 or v_count <> trunc(v_count) or v_count > v_previous then
      raise exception '% 누적 수량은 0~%개로 입력하세요', v_names[i+1], v_previous;
    end if;
    v_previous := v_count;
  end loop;
  for i in 0..5 loop
    v_count := (p_quantities->>v_names[i+1])::numeric;
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

create or replace function public.reverse_production_progress(p_event_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.production_events%rowtype;
  v_retry public.production_events%rowtype;
  v_order public.work_orders%rowtype;
begin
  select * into v_event from public.production_events where event_id=p_event_id;
  if not found or v_event.kind <> 'completion' then raise exception '취소할 처리 기록을 찾을 수 없습니다'; end if;
  select * into v_order from public.work_orders where wo_id=v_event.wo_id for update;
  if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
  if p_request_id is null then raise exception '요청 번호가 필요합니다'; end if;
  select * into v_retry from public.production_events where event_id=p_request_id;
  if found then
    if v_retry.reversal_of is distinct from p_event_id then raise exception '동일 요청 번호로 다른 기록을 취소할 수 없습니다'; end if;
  else
    if exists(select 1 from public.production_events where reversal_of=p_event_id) then raise exception '이미 취소된 기록입니다'; end if;
    insert into public.production_events(event_id,wo_id,step,quantity,kind,reversal_of,note)
    values(p_request_id,v_event.wo_id,v_event.step,-v_event.quantity,'reversal',p_event_id,'입력 실적 취소');
  end if;
  select * into v_order from public.work_orders where wo_id=v_event.wo_id;
  return to_jsonb(v_order);
end;
$$;

revoke all on function public.guard_production_quantities() from public, anon, authenticated;
revoke all on function public.refresh_production_quantities() from public, anon, authenticated;
revoke all on function public.record_production_progress(text,integer,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.initialize_production_quantities(text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.reverse_production_progress(uuid,uuid) from public, anon, authenticated;
-- Matches the existing public shop-floor scanner and no-login management mode.
grant execute on function public.record_production_progress(text,integer,integer,uuid,text) to anon, authenticated;
grant execute on function public.initialize_production_quantities(text,jsonb,uuid) to anon, authenticated;
grant execute on function public.reverse_production_progress(uuid,uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
