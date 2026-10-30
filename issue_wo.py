import sys
import qrcode
from PySide6.QtWidgets import QApplication, QMainWindow, QPushButton, QVBoxLayout, QWidget, QLabel, QMessageBox
from PySide6.QtGui import QPixmap
from PySide6.QtCore import Qt


from supabase_config import supabase


class IssueWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 작업지시서 발행 (사무실용)")
        self.setGeometry(100, 100, 400, 400)

        layout = QVBoxLayout()

        # 발행 버튼
        self.btn_issue = QPushButton("지시서(선박용 캠 100개) 발행 및 QR 생성")
        self.btn_issue.setMinimumHeight(50)
        self.btn_issue.clicked.connect(self.issue_work_order)
        layout.addWidget(self.btn_issue)

        # QR코드를 보여줄 라벨
        self.qr_label = QLabel("여기에 바코드(QR)가 표시됩니다.")
        self.qr_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.qr_label)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)

    def issue_work_order(self):
        wo_number = "WO-261030-001" # 생성할 바코드 번호

        # 1. DB에 '단중'이 포함된 캠 품목 마스터 등록 (이미 있으면 무시)
        try:
            supabase.table('items').insert({
                "item_code": "CAM-001",
                "item_name": "선박 엔진용 캠 A형",
                "unit_weight": 15.5
            }).execute()
        except:
            pass 

        # 2. 작업지시서 DB 등록
        try:
            supabase.table('work_orders').insert({
                "wo_id": wo_number,
                "client_code": "C-001", # 앞서 만든 수경스틸
                "item_code": "CAM-001",
                "target_qty": 100,
                "current_step": "발행대기"
            }).execute()
        except Exception as e:
            pass # 중복 등록 에러 무시

        # 3. QR코드 이미지 파일 생성 및 저장
        qr = qrcode.make(wo_number) 
        qr_filename = f"{wo_number}.png"
        qr.save(qr_filename)

        # 4. 화면에 생성된 QR코드 띄우기
        pixmap = QPixmap(qr_filename)
        self.qr_label.setPixmap(pixmap.scaled(200, 200, Qt.KeepAspectRatio))
        QMessageBox.information(self, "성공", f"{wo_number} 발행 완료!\n폴더에 QR 이미지 파일이 저장되었습니다.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = IssueWindow()
    window.show()
    sys.exit(app.exec())