# 주조 공정 웹 앱

Node.js 20.9 이상에서 `npm install`, `npm run dev`로 실행합니다.
`.env.local`에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 설정합니다.
Cloudflare Pages: 빌드 명령 `npm run build`, 출력 디렉터리 `out`, 루트 디렉터리 빈칸.

운영 주소: https://test-ict.pages.dev
작업지시 관리: https://test-ict.pages.dev/orders/
현장 스캐너: https://test-ict.pages.dev/scanner/

## 작업지시 관리

작업지시 번호는 등록 시 직접 입력합니다. 등록 후에는 자재 연결을 보존하기 위해 번호를 변경하지 않습니다.
로그인 없이 사용할 수 있는 화면입니다. 기존 DB에는 아래 권한 전환 SQL도 적용해야 실제 저장할 수 있습니다.

1. 최초 설정은 `supabase/production_management.sql`을 실행합니다.
2. 로그인 없는 관리가 필요하면 `supabase/anonymous_management.sql` 전체를 SQL Editor에서 실행합니다.
3. 공개 URL과 공개 키를 가진 사용자가 등록·수정·삭제할 수 있는 모드입니다. 기존 관리자 계정은 삭제하지 않습니다.

기존 작업지시 및 자재 데이터는 SQL 적용으로 변경되지 않습니다.
작업지시 수정에서 자재 행을 제거하면 해당 투입 내역이 삭제되고, 작업지시 삭제는 연결된 자재 내역도 삭제합니다.
지시서 / QR 인쇄에서 작업지시 내용을 인쇄하거나 PDF로 저장할 수 있습니다.
납기일이 지났고 출고가 완료되지 않았으면 납기 지연으로 표시합니다.

## 현장 스캔

조형 → 주입 → 가공 → 검사 → 포장 → 출고를 선택하고 QR 또는 USB 바코드 리더기로 지시번호를 입력합니다.
카메라는 HTTPS/localhost에서 권한을 허용해야 작동합니다.
현재 공정 완료 상태를 덮어쓰며 별도 공정 이력/순서 검증은 제공하지 않습니다.

## 배포 주소

`https://<배포ID>.test-ict.pages.dev`는 특정 배포 내용을 보존하는 고정 주소입니다.
Git push로 과거 고정 주소를 덮어쓸 수 없으므로 최신 화면은 운영 주소를 사용하세요.
이후 배포의 고정 주소에는 최신 운영 화면으로 이동하는 안내가 표시됩니다.