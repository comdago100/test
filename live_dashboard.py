import sys
from PySide6.QtWidgets import (QApplication, QMainWindow, QVBoxLayout, QWidget, 
                               QTableWidget, QTableWidgetItem, QHeaderView, QLabel, QHBoxLayout, QPushButton)
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QFont


from supabase_config import supabase


class LiveDashboard(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 실시간 생산 현황판 (사무실용)")
        self.setGeometry(100, 100, 1000, 600)

        layout = QVBoxLayout()

        # 상단 헤더 영역
        header_layout = QHBoxLayout()
        title_label = QLabel("🚀 실시간 공정 모니터링")
        title_label.setFont(QFont("Arial", 20, QFont.Bold))
        header_layout.addWidget(title_label)

        self.last_update_label = QLabel("마지막 업데이트: 대기 중...")
        self.last_update_label.setFont(QFont("Arial", 12))
        self.last_update_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.last_update_label.setStyleSheet("color: gray;")
        header_layout.addWidget(self.last_update_label)
        
        layout.addLayout(header_layout)

        # 데이터 테이블
        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["지시서 번호", "거래처", "품목", "목표 수량", "현재 공정 상태"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.setFont(QFont("Arial", 12))
        
        # 행 높이 넉넉하게 설정
        self.table.verticalHeader().setDefaultSectionSize(40)
        # 읽기 전용 설정
        self.table.setEditTriggers(QTableWidget.NoEditTriggers) 
        layout.addWidget(self.table)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)

        # 1. 프로그램 실행 시 즉시 데이터 1회 로드
        self.load_data()

        # 2. 5초(5000ms)마다 자동으로 DB를 조회하는 타이머 설정 (핵심 기능)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.load_data)
        self.timer.start(5000)

    def load_data(self):
        try:
            # DB에서 작업지시서 전체 조회 (최신 발행순 정렬)
            response = supabase.table('work_orders').select("*").order("created_at", desc=True).execute()
            data = response.data

            self.table.setRowCount(len(data))
            
            for row_idx, wo in enumerate(data):
                # 기본 정보 입력
                self.table.setItem(row_idx, 0, QTableWidgetItem(wo.get('wo_id', '')))
                self.table.setItem(row_idx, 1, QTableWidgetItem(wo.get('client_code', '')))
                self.table.setItem(row_idx, 2, QTableWidgetItem(wo.get('item_code', '')))
                
                qty_item = QTableWidgetItem(f"{wo.get('target_qty', 0):,} 개")
                qty_item.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.table.setItem(row_idx, 3, qty_item)
                
                # 현재 공정 상태 표기 및 상태별 색상 하이라이트
                status_text = wo.get('current_step', '')
                status_item = QTableWidgetItem(status_text)
                status_item.setTextAlignment(Qt.AlignCenter)
                status_item.setFont(QFont("Arial", 12, QFont.Bold))
                
                # 공정 상태에 따라 한눈에 띄도록 배경색 지정
                if status_text == '발행대기':
                    status_item.setBackground(QColor(224, 224, 224)) # 옅은 회색
                elif '주입' in status_text:
                    status_item.setBackground(QColor(255, 204, 153)) # 주황색 (쇳물 느낌)
                elif '가공' in status_text:
                    status_item.setBackground(QColor(153, 204, 255)) # 파란색
                elif '검사' in status_text:
                    status_item.setBackground(QColor(144, 238, 144)) # 연두색 (완료 느낌)
                    
                self.table.setItem(row_idx, 4, status_item)

            # 마지막 업데이트 시간 갱신
            from datetime import datetime
            now_str = datetime.now().strftime("%H:%M:%S")
            self.last_update_label.setText(f"마지막 업데이트: {now_str} (5초 자동 갱신)")

        except Exception as e:
            self.last_update_label.setText("네트워크 연결 끊김... 재시도 중")
            self.last_update_label.setStyleSheet("color: red;")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = LiveDashboard()
    window.show()
    sys.exit(app.exec())