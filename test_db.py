

from supabase_config import supabase


def test_db_connection():
    # 1. 거래처 테이블에 데이터 1건 입력
    print("--- 테스트 거래처 입력 시도 ---")
    insert_response = supabase.table('clients').insert({
        "client_code": "C-001",
        "client_name": "수경스틸",
        "contact_info": "051-000-0000"
    }).execute()
    
    print("입력 완료:", insert_response.data)

    # 2. 입력된 데이터 불러오기
    print("\n--- 전체 거래처 목록 조회 ---")
    select_response = supabase.table('clients').select("*").execute()
    
    for client in select_response.data:
        print(f"[{client['client_code']}] {client['client_name']} ({client['contact_info']})")

if __name__ == "__main__":
    test_db_connection()