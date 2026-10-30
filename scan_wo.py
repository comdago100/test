import sys
from PySide6.QtWidgets import QApplication, QMainWindow, QLineEdit, QVBoxLayout, QWidget, QLabel
from PySide6.QtGui import QFont
from PySide6.QtCore import Qt


from supabase_config import supabase


class ScannerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("현장용 스캐너 - [주입 공정]")
        self.setGeometry(150, 150, 600, 300)

        layout = QVBoxLayout()

        # 현장에서 멀리서도 보이도록 큼직한 글씨 설정
        self.info_label = QLabel("작업지시서 바코드를 스캔하세요")
        self.info_label.setFont(QFont("Arial", 24, QFont.Bold))
        self.info_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.info_label)

        # 바코드 스캐너가 값을 입력할 숨겨진/또는 보여지는 입력창
        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText("바코드 입력 대기 중...")
        self.scan_input.setFont(QFont("Arial", 14))
        # 바코드 스캐너가 찍고 '엔터'를 치는 순간 process_scan 함수가 실행됨
        self.scan_input.returnPressed.connect(self.process_scan) 
        layout.addWidget(self.scan_input)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)
        
        # 프로그램이 켜지면 무조건 입력창에 커서가 가도록 세팅
        self.scan_input.setFocus()

    def process_scan(self):
        wo_id = self.scan_input.text().strip() # 스캔된 바코드 번호 (예: WO-261030-001)
        if not wo_id:
            return

        try:
            # DB 업데이트: 해당 바코드의 공정 상태를 '주입완료'로 바꿉니다.
            response = supabase.table('work_orders').update({"current_step": "주입완료"}).eq("wo_id", wo_id).execute()
            
            if len(response.data) > 0:
                self.info_label.setText(f"[{wo_id}]\n주입완료 처리되었습니다! OK")
                self.info_label.setStyleSheet("color: blue;")
            else:
                self.info_label.setText(f"[{wo_id}]\n없는 지시서입니다. 다시 확인하세요.")
                self.info_label.setStyleSheet("color: red;")
        except Exception as e:
            self.info_label.setText("통신 에러가 발생했습니다.")
            self.info_label.setStyleSheet("color: red;")
        
        # 다음 스캔을 위해 입력창을 비우고 커서를 다시 맞춤
        self.scan_input.clear()
        self.scan_input.setFocus()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = ScannerWindow()
    window.show()
    sys.exit(app.exec())