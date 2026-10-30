-- Run in Supabase SQL Editor. Preserves existing work orders and material records.
begin;

alter table public.work_orders
  add column if not exists due_date date,
  add column if not exists start_date date,
  add column if not exists actual_qty numeric,
  add column if not exists unit_weight_kg numeric,
  add column if not exists heat_no text,
  add column if not exists casting_material text,
  add column if not exists notes text;

create table if not exists public.production_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.production_admins enable row level security;
revoke all on public.production_admins from anon, authenticated;

create or replace function public.save_production_order(p_order jsonb, p_materials jsonb, p_create boolean, p_original_usage_ids jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := nullif(trim(p_order->>'wo_id'), '');
  v_row jsonb;
  v_usage_id text;
begin
  if auth.uid() is null or not exists (select 1 from public.production_admins where user_id = auth.uid()) then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if v_id is null or nullif(trim(p_order->>'client_code'), '') is null
     or nullif(trim(p_order->>'item_code'), '') is null
     or (p_order->>'target_qty')::numeric <= 0
     or jsonb_typeof(p_materials) is distinct from 'array' or jsonb_typeof(p_original_usage_ids) is distinct from 'array' then
    raise exception '작업지시 필수 항목을 확인하세요';
  end if;
  if not exists (select 1 from public.clients where client_code = p_order->>'client_code')
     or not exists (select 1 from public.items where item_code = p_order->>'item_code') then
    raise exception '등록된 거래처와 품목을 선택하세요';
  end if;
  if exists (select 1 from jsonb_array_elements(p_materials) x
             where nullif(trim(x->>'raw_code'), '') is null
                or coalesce((x->>'input_qty')::numeric, 0) <= 0
                or not exists (select 1 from public.raw_materials m where m.raw_code = x->>'raw_code')) then
    raise exception '원재료와 투입량을 확인하세요';
  end if;
  if coalesce(nullif(p_order->>'actual_qty','')::numeric, 0) < 0
     or coalesce(nullif(p_order->>'unit_weight_kg','')::numeric, 0) < 0
     or (nullif(p_order->>'start_date','')::date > nullif(p_order->>'due_date','')::date) then
    raise exception '작업일과 생산 수량, 중량을 확인하세요';
  end if;
  if not p_create then
    perform 1 from public.work_orders where wo_id=v_id for update;
    if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
    if exists (
      select 1 from public.material_usage u where u.wo_id=v_id
      and not exists (select 1 from jsonb_array_elements_text(p_original_usage_ids) x where x=u.usage_id::text)
    ) or exists (
      select 1 from jsonb_array_elements_text(p_original_usage_ids) x
      where not exists (select 1 from public.material_usage u where u.wo_id=v_id and u.usage_id::text=x)
    ) then
      raise exception '자재 내역이 변경되었습니다. 창을 닫고 다시 열어 주세요';
    end if;
  end if;
  if p_create then
    insert into public.work_orders (wo_id, client_code, item_code, target_qty, current_step, due_date, start_date, actual_qty, unit_weight_kg, heat_no, casting_material, notes)
    values (v_id, p_order->>'client_code', p_order->>'item_code', (p_order->>'target_qty')::numeric, '발행대기',
      nullif(p_order->>'due_date','')::date, nullif(p_order->>'start_date','')::date,
      nullif(p_order->>'actual_qty','')::numeric, nullif(p_order->>'unit_weight_kg','')::numeric,
      nullif(trim(p_order->>'heat_no'),''), nullif(trim(p_order->>'casting_material'),''), nullif(trim(p_order->>'notes'),''));
  else
    update public.work_orders set client_code=p_order->>'client_code', item_code=p_order->>'item_code',
      target_qty=(p_order->>'target_qty')::numeric, due_date=nullif(p_order->>'due_date','')::date,
      start_date=nullif(p_order->>'start_date','')::date, actual_qty=nullif(p_order->>'actual_qty','')::numeric,
      unit_weight_kg=nullif(p_order->>'unit_weight_kg','')::numeric, heat_no=nullif(trim(p_order->>'heat_no'),''),
      casting_material=nullif(trim(p_order->>'casting_material'),''), notes=nullif(trim(p_order->>'notes'),'')
    where wo_id=v_id;
    if not found then raise exception '작업지시를 찾을 수 없습니다'; end if;
  end if;

  -- Check every existing ID before changing anything, then preserve unchanged record IDs and dates.
  for v_row in select value from jsonb_array_elements(p_materials) loop
    v_usage_id := nullif(v_row->>'usage_id','');
    if v_usage_id is not null and not exists (select 1 from public.material_usage where wo_id=v_id and usage_id::text=v_usage_id) then
      raise exception '투입 내역이 변경되었습니다. 새로고침 후 다시 시도하세요';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_materials) x where nullif(x->>'usage_id','') is not null
             group by x->>'usage_id' having count(*) > 1) then
    raise exception '중복된 자재 투입 내역입니다';
  end if;
  delete from public.material_usage u where u.wo_id=v_id and not exists
    (select 1 from jsonb_array_elements(p_materials) x where x->>'usage_id'=u.usage_id::text);
  for v_row in select value from jsonb_array_elements(p_materials) loop
    v_usage_id := nullif(v_row->>'usage_id','');
    if v_usage_id is null then
      insert into public.material_usage (wo_id, raw_code, input_qty)
        values (v_id, v_row->>'raw_code', (v_row->>'input_qty')::numeric);
    else
      update public.material_usage set raw_code=v_row->>'raw_code', input_qty=(v_row->>'input_qty')::numeric
        where wo_id=v_id and usage_id::text=v_usage_id;
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.delete_production_order(p_wo_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.production_admins where user_id = auth.uid()) then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if not exists (select 1 from public.work_orders where wo_id=p_wo_id) then
    raise exception '작업지시를 찾을 수 없습니다';
  end if;
  delete from public.material_usage where wo_id=p_wo_id;
  delete from public.work_orders where wo_id=p_wo_id;
end;
$$;

create or replace function public.create_production_master(p_kind text, p_code text, p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.production_admins where user_id = auth.uid()) then
    raise exception '관리자 권한이 필요합니다';
  end if;
  if nullif(trim(p_code),'') is null or nullif(trim(p_name),'') is null then
    raise exception '코드와 이름을 입력하세요';
  end if;
  if p_kind = 'client' then
    insert into public.clients (client_code,client_name,contact_info) values (trim(p_code),trim(p_name),'');
  elsif p_kind = 'item' then
    insert into public.items (item_code,item_name,unit_weight) values (trim(p_code),trim(p_name),0);
  elsif p_kind = 'material' then
    insert into public.raw_materials (raw_code,raw_name,unit) values (trim(p_code),trim(p_name),'kg');
  else
    raise exception '지원하지 않는 구분입니다';
  end if;
end;
$$;
revoke all on function public.create_production_master(text,text,text) from public, anon;
grant execute on function public.create_production_master(text,text,text) to authenticated;
revoke all on function public.save_production_order(jsonb,jsonb,boolean,jsonb) from public, anon;
revoke all on function public.delete_production_order(text) from public, anon;
grant execute on function public.save_production_order(jsonb,jsonb,boolean,jsonb) to authenticated;
grant execute on function public.delete_production_order(text) to authenticated;
commit;

-- Create the administrator in Authentication > Users first, then run:
-- insert into public.production_admins (user_id)
-- select id from auth.users where email = '관리자_이메일'
-- on conflict do nothing;