import sys
from PySide6.QtWidgets import QApplication, QMainWindow, QLineEdit, QVBoxLayout, QWidget, QLabel, QComboBox
from PySide6.QtGui import QFont
from PySide6.QtCore import Qt


from supabase_config import supabase


class StationScanner(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 현장 통합 스캐너 (4공정)")
        self.setGeometry(200, 200, 600, 300)

        layout = QVBoxLayout()

        # 4개 공정 드롭다운 세팅
        self.station_combo = QComboBox()
        self.station_combo.setFont(QFont("Arial", 16))
        self.station_combo.addItems([
            "[1공정] 조형장 - 조형 완료",
            "[2공정] 주입장 - 쇳물 주입 완료",
            "[3공정] 가공장 - 사상/가공 완료",
            "[4공정] 검사장 - 최종 검사 완료"
        ])
        layout.addWidget(self.station_combo)

        self.info_label = QLabel("작업지시서 바코드를 스캔하세요")
        self.info_label.setFont(QFont("Arial", 24, QFont.Bold))
        self.info_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.info_label)

        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText("바코드 입력 대기 중...")
        self.scan_input.setFont(QFont("Arial", 16))
        self.scan_input.returnPressed.connect(self.process_scan) 
        layout.addWidget(self.scan_input)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)
        
        self.scan_input.setFocus()
        self.station_combo.currentIndexChanged.connect(lambda: self.scan_input.setFocus())

    def process_scan(self):
        wo_id = self.scan_input.text().strip()
        if not wo_id: return

        selected_station = self.station_combo.currentText()
        if "조형" in selected_station: next_step = "조형완료"
        elif "주입" in selected_station: next_step = "주입완료"
        elif "가공" in selected_station: next_step = "가공완료"
        elif "검사" in selected_station: next_step = "검사완료"

        try:
            response = supabase.table('work_orders').update({"current_step": next_step}).eq("wo_id", wo_id).execute()
            
            if len(response.data) > 0:
                self.info_label.setText(f"[{wo_id}]\n{next_step} 처리되었습니다! OK")
                self.info_label.setStyleSheet("color: blue;")
            else:
                self.info_label.setText(f"[{wo_id}]\n없는 지시서입니다.")
                self.info_label.setStyleSheet("color: red;")
        except:
            self.info_label.setText("통신 에러가 발생했습니다.")
            self.info_label.setStyleSheet("color: red;")
        
        self.scan_input.clear()
        self.scan_input.setFocus()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = StationScanner()
    window.show()
    sys.exit(app.exec())