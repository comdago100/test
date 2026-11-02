-- Apply after production_management.sql (and anonymous_management.sql when used).
-- Preserves client codes, contact_info, work orders and production history.
begin;
alter table public.clients
  add column if not exists client_type text not null default 'customer',
  add column if not exists business_number text,
  add column if not exists representative text,
  add column if not exists business_type text,
  add column if not exists business_item text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists phone text,
  add column if not exists fax text,
  add column if not exists email text,
  add column if not exists tax_email text,
  add column if not exists postal_code text,
  add column if not exists address text,
  add column if not exists shipping_address text,
  add column if not exists delivery_notes text,
  add column if not exists payment_terms text,
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists client_updated_at timestamptz not null default clock_timestamp();

create or replace function public.touch_production_client()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new is distinct from old then new.client_updated_at := clock_timestamp(); end if;
  return new;
end;
$$;
drop trigger if exists touch_production_client on public.clients;
create trigger touch_production_client before update on public.clients
for each row execute function public.touch_production_client();

create or replace function public.save_production_client(
  p_client jsonb, p_create boolean, p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := nullif(trim(p_client->>'client_code'),'');
  v_name text := nullif(trim(p_client->>'client_name'),'');
  v_type text := coalesce(nullif(p_client->>'client_type',''),'customer');
  v_business text := regexp_replace(coalesce(p_client->>'business_number',''),'[-[:space:]]','','g');
  v_row public.clients%rowtype;
  v_key text;
  v_label text;
  v_limit integer;
begin
  -- Preserve the deployment's existing administrator-only or no-login mode.
  if not has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE')
    and (auth.uid() is null or not exists(select 1 from public.production_admins where user_id=auth.uid())) then
    raise exception '관리자 권한이 필요합니다' using errcode='42501';
  end if;
  if jsonb_typeof(p_client) is distinct from 'object' or p_create is null
    or v_id is null or v_name is null or length(v_id)>80 or length(v_name)>200
    or (p_create and v_id ~ '[[:space:]]') then
    raise exception '거래처 코드와 거래처명을 확인하세요';
  end if;
  if v_type not in ('customer','supplier','both','outsourcer')
    or jsonb_typeof(p_client->'is_active') is distinct from 'boolean' then
    raise exception '거래처 구분과 사용 상태를 확인하세요';
  end if;
  if v_business<>'' and v_business !~ '^[0-9]{10}$' then
    raise exception '사업자등록번호는 숫자 10자리로 입력하세요';
  end if;
  if coalesce(trim(p_client->>'postal_code'),'')<>'' and trim(p_client->>'postal_code') !~ '^[0-9]{5}$' then
    raise exception '국내 우편번호는 숫자 5자리로 입력하세요';
  end if;
  foreach v_key in array array['email','tax_email'] loop
    if coalesce(trim(p_client->>v_key),'')<>'' and trim(p_client->>v_key) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception '이메일 주소 형식을 확인하세요';
    end if;
  end loop;
  for v_key,v_label,v_limit in select * from (values
    ('representative','대표자명',100),('business_type','업태',100),('business_item','종목',200),
    ('contact_name','담당자명',100),('contact_phone','담당자 연락처',50),('phone','대표 전화',50),
    ('fax','팩스',50),('email','이메일',254),('tax_email','계산서 수신 이메일',254),
    ('address','사업장 주소',500),('shipping_address','납품 주소',500),
    ('delivery_notes','납품 안내',1000),('payment_terms','결제 조건',200),('notes','거래처 메모',2000)
  ) fields(key,label,max_length) loop
    if length(coalesce(trim(p_client->>v_key),''))>v_limit then
      raise exception '%은 %자 이내로 입력하세요',v_label,v_limit;
    end if;
  end loop;
  if p_create then
    insert into public.clients(client_code,client_name,contact_info) values(v_id,v_name,'');
  else
    select * into v_row from public.clients where client_code=v_id for update;
    if not found then raise exception '거래처를 찾을 수 없습니다'; end if;
    if v_row.client_updated_at is distinct from p_expected_updated_at then
      raise exception '다른 사용자가 거래처를 수정했습니다. 목록을 새로고침하고 다시 열어 주세요';
    end if;
  end if;
  update public.clients set
    client_name=v_name,client_type=v_type,business_number=nullif(v_business,''),
    representative=nullif(trim(p_client->>'representative'),''),
    business_type=nullif(trim(p_client->>'business_type'),''),
    business_item=nullif(trim(p_client->>'business_item'),''),
    contact_name=nullif(trim(p_client->>'contact_name'),''),
    contact_phone=nullif(trim(p_client->>'contact_phone'),''),
    phone=nullif(trim(p_client->>'phone'),''),fax=nullif(trim(p_client->>'fax'),''),
    email=nullif(trim(p_client->>'email'),''),tax_email=nullif(trim(p_client->>'tax_email'),''),
    postal_code=nullif(trim(p_client->>'postal_code'),''),
    address=nullif(trim(p_client->>'address'),''),
    shipping_address=nullif(trim(p_client->>'shipping_address'),''),
    delivery_notes=nullif(trim(p_client->>'delivery_notes'),''),
    payment_terms=nullif(trim(p_client->>'payment_terms'),''),
    notes=nullif(trim(p_client->>'notes'),''),is_active=(p_client->>'is_active')::boolean
  where client_code=v_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.guard_work_order_client()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='INSERT' or new.client_code is distinct from old.client_code then
    if exists(select 1 from public.clients where client_code=new.client_code and not is_active) then
      raise exception '거래중지된 거래처에는 새 작업지시를 등록할 수 없습니다';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_work_order_client on public.work_orders;
create trigger guard_work_order_client before insert or update of client_code on public.work_orders
for each row execute function public.guard_work_order_client();

revoke all on function public.touch_production_client() from public,anon,authenticated;
revoke all on function public.guard_work_order_client() from public,anon,authenticated;
revoke all on function public.save_production_client(jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.save_production_client(jsonb,boolean,timestamptz) to authenticated;
do $$ begin
  if has_function_privilege('anon','public.create_production_master(text,text,text)','EXECUTE') then
    grant execute on function public.save_production_client(jsonb,boolean,timestamptz) to anon;
  end if;
end; $$;
notify pgrst, 'reload schema';
commit;
