import sys
from PySide6.QtWidgets import QApplication, QMainWindow, QPushButton, QVBoxLayout, QWidget, QTableWidget, QTableWidgetItem, QHeaderView
from PySide6.QtGui import QColor
from PySide6.QtCore import Qt


from supabase_config import supabase


class AdminDashboard(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 생산 현황판 (사무실 모니터링)")
        self.setGeometry(100, 100, 800, 400)

        layout = QVBoxLayout()

        # 새로고침 버튼
        self.btn_refresh = QPushButton("현장 공정 실시간 새로고침")
        self.btn_refresh.setMinimumHeight(40)
        self.btn_refresh.clicked.connect(self.load_data)
        layout.addWidget(self.btn_refresh)

        # 데이터를 보여줄 테이블 위젯
        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["지시서 번호", "거래처", "품목", "수량", "현재 공정 상태"])
        # 열 너비를 꽉 차게 비율 조정
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout.addWidget(self.table)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)

        # 프로그램 실행 시 즉시 데이터 불러오기
        self.load_data()

    def load_data(self):
        # 1. DB에서 작업지시서 전체 조회 (최신순 정렬)
        response = supabase.table('work_orders').select("*").order("created_at", desc=True).execute()
        data = response.data

        self.table.setRowCount(len(data))
        
        # 2. 테이블에 데이터 채워 넣기
        for row_idx, wo in enumerate(data):
            self.table.setItem(row_idx, 0, QTableWidgetItem(wo.get('wo_id', '')))
            self.table.setItem(row_idx, 1, QTableWidgetItem(wo.get('client_code', '')))
            self.table.setItem(row_idx, 2, QTableWidgetItem(wo.get('item_code', '')))
            self.table.setItem(row_idx, 3, QTableWidgetItem(str(wo.get('target_qty', ''))))
            
            # 현재 공정 상태 표기 및 색상 하이라이트
            status_text = wo.get('current_step', '')
            status_item = QTableWidgetItem(status_text)
            
            if status_text == '주입완료':
                status_item.setBackground(QColor(144, 238, 144)) # 연두색으로 하이라이트
                status_item.setForeground(Qt.black)
                
            self.table.setItem(row_idx, 4, status_item)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = AdminDashboard()
    window.show()
    sys.exit(app.exec())