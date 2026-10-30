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