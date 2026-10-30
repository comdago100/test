# 주조 공정 웹 앱

## 실행

Node.js 20 이상에서 `npm install`을 실행하고, 프로젝트 루트의 `.env.local`에 다음 값을 설정합니다.

```
NEXT_PUBLIC_SUPABASE_URL=프로젝트_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=공개_anon_또는_publishable_키
```

`npm run dev` 후 http://localhost:3000 에서 생산 현황을, /scanner/에서 스캐너를 엽니다.
USB 바코드 스캐너는 입력칸에 값을 입력하고 Enter를 보내도록 설정합니다.
카메라 스캔은 HTTPS 또는 localhost와 카메라 권한이 필요합니다.

## Cloudflare Pages

GitHub 저장소의 이 브랜치를 연결하고 빌드 명령 `npm run build`, 빌드 출력 디렉터리 `out`을 설정합니다. 위의 두 NEXT_PUBLIC 환경 변수를 Pages 빌드 환경에도 설정하세요. 앱은 정적 사이트로 빌드되며 Supabase에 브라우저에서 직접 연결합니다.

NEXT_PUBLIC 값은 브라우저에 공개됩니다. service_role 키는 절대 사용하지 마세요. 공개하기 전에 Supabase RLS 및 로그인/접근 정책을 설정하고, 현장과 관리자에 필요한 권한만 허용하세요. 이 앱은 기존 Python 앱과 동일한 익명 키 기반 연결을 사용하며 자체 로그인 기능은 제공하지 않습니다.

## 현재 기능 범위

기존 스캐너와 같이 선택한 공정의 완료 상태를 work_orders.current_step에 기록합니다. 공정 순서 검증과 이력 저장은 기존 DB에 없으므로 제공하지 않습니다. 대시보드는 5초 간격으로 데이터를 다시 조회합니다. 납기일, 실제 수량, 작업 시작일은 현재 DB에 없어 표시하지 않습니다.
## 작업지시 관리자 기능 설정

관리자 기능을 사용하려면 Supabase 프로젝트의 SQL Editor에서 `supabase/production_management.sql` 전체를 실행합니다. 스크립트는 기존 데이터를 유지하면서 작업지시의 납기일, 시작일, 실제 생산량, 단중, 용해 번호, 재질 및 메모 열을 추가합니다. 새로운 관리 함수는 관리자로 등록된 Supabase Auth 사용자만 호출할 수 있습니다.

1. Supabase Authentication > Users에서 이메일/비밀번호 관리자를 생성합니다.
2. SQL Editor에서 다음 SQL의 이메일을 실제 관리자 이메일로 바꾸어 실행합니다.

```sql
insert into public.production_admins (user_id)
select id from auth.users where email = '관리자_이메일'
on conflict do nothing;
```

3. 관리자 화면에서 해당 계정으로 로그인합니다. 생성된 사용자가 없는 이메일이면 위 SQL은 0행을 삽입하므로 먼저 사용자를 확인하세요.

작업지시 수정 화면에서 기존 자재 투입 내역을 제거하면 해당 내역이 삭제됩니다. 작업지시 삭제 시 연결된 투입 내역도 삭제됩니다. 작성한 데이터는 단일 DB 함수에서 처리하여 오류가 발생하면 되돌립니다. 기존 스캐너는 변경하지 않았습니다.

중요: 이 마이그레이션은 기존 work_orders, material_usage 등 테이블의 기존 RLS 정책이나 직접 접근 권한을 변경하지 않습니다. 기존 익명 쓰기 정책이 허용된 경우 관리자 함수의 로그인 검사만으로는 직접 API 요청을 차단할 수 없습니다. 공개 운영 전 기존 정책을 점검하고 현장 스캐너가 사용할 제한된 인증 및 정책을 구성해야 합니다. 추가한 SQL은 별도 DB 관리 권한이 있어야 실행할 수 있습니다.