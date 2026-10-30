import sys
from PySide6.QtWidgets import (QApplication, QMainWindow, QLineEdit, QVBoxLayout, 
                               QHBoxLayout, QWidget, QLabel, QPushButton, QSpinBox, QMessageBox, QGroupBox)
from PySide6.QtGui import QFont
from PySide6.QtCore import Qt


from supabase_config import supabase


class AdminMaterialWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 사무실 - 원자재 투입 일괄 등록")
        self.setGeometry(200, 200, 500, 450)
        self.current_wo_id = None

        layout = QVBoxLayout()

        # 1. 지시서 번호 입력 영역 (사무실이므로 키보드 타이핑 위주)
        layout.addWidget(QLabel("1. 작업지시서 번호 입력 (예: WO-261030-001)"))
        
        search_layout = QHBoxLayout()
        self.wo_input = QLineEdit()
        self.wo_input.setFont(QFont("Arial", 12))
        self.wo_input.returnPressed.connect(self.search_wo)
        search_layout.addWidget(self.wo_input)

        self.btn_search = QPushButton("조회")
        self.btn_search.clicked.connect(self.search_wo)
        search_layout.addWidget(self.btn_search)
        layout.addLayout(search_layout)

        self.status_label = QLabel("지시서 번호를 입력하고 조회를 눌러주세요.")
        self.status_label.setStyleSheet("color: gray;")
        layout.addWidget(self.status_label)

        # 2. 원자재 중량 입력 영역
        self.mat_group = QGroupBox("2. 투입된 원자재 중량 (작업일지 기준)")
        self.mat_group.setFont(QFont("Arial", 11, QFont.Bold))
        mat_layout = QVBoxLayout()

        self.mat_inputs = {}
        materials = [("RAW-001", "고철A"), ("RAW-002", "선철"), ("RAW-003", "구상화제")]
        
        for code, name in materials:
            row = QHBoxLayout()
            lbl = QLabel(name)
            spin = QSpinBox()
            spin.setRange(0, 50000) # 최대 50톤
            spin.setSuffix(" kg")
            spin.setMinimumHeight(35)
            spin.setFont(QFont("Arial", 12))
            
            row.addWidget(lbl)
            row.addWidget(spin)
            mat_layout.addLayout(row)
            self.mat_inputs[code] = spin

        self.mat_group.setLayout(mat_layout)
        self.mat_group.setEnabled(False) # 지시서 조회 전까지 잠금
        layout.addWidget(self.mat_group)

        # 3. 저장 버튼
        self.btn_save = QPushButton("자재 투입 내역 DB 저장")
        self.btn_save.setMinimumHeight(50)
        self.btn_save.setFont(QFont("Arial", 12, QFont.Bold))
        self.btn_save.setStyleSheet("background-color: #2196F3; color: white;")
        self.btn_save.setEnabled(False)
        self.btn_save.clicked.connect(self.save_data)
        layout.addWidget(self.btn_save)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)

    def search_wo(self):
        wo_id = self.wo_input.text().strip()
        if not wo_id: return

        response = supabase.table('work_orders').select("*").eq("wo_id", wo_id).execute()
        if len(response.data) > 0:
            self.current_wo_id = wo_id
            # 해당 지시서의 현재 공정 상태를 화면에 표시
            current_step = response.data[0].get('current_step', '')
            self.status_label.setText(f"[{wo_id}] 확인됨. (현재 상태: {current_step})")
            self.status_label.setStyleSheet("color: blue; font-weight: bold;")
            
            self.mat_group.setEnabled(True)
            self.btn_save.setEnabled(True)
        else:
            self.status_label.setText("존재하지 않는 지시서 번호입니다.")
            self.status_label.setStyleSheet("color: red;")
            self.mat_group.setEnabled(False)
            self.btn_save.setEnabled(False)

    def save_data(self):
        if not self.current_wo_id: return

        try:
            # 입력된 투입량이 있는 자재만 DB에 저장
            for code, spin in self.mat_inputs.items():
                qty = spin.value()
                if qty > 0:
                    supabase.table('material_usage').insert({
                        "wo_id": self.current_wo_id,
                        "raw_code": code,
                        "input_qty": qty
                    }).execute()

            QMessageBox.information(self, "성공", f"[{self.current_wo_id}] 원자재 투입량 저장이 완료되었습니다.\n(이 데이터는 추후 이카운트 연동에 사용됩니다.)")
            
            # 초기화
            self.current_wo_id = None
            self.wo_input.clear()
            self.wo_input.setFocus()
            for spin in self.mat_inputs.values():
                spin.setValue(0)
            self.status_label.setText("다음 지시서 번호를 입력해 주세요.")
            self.status_label.setStyleSheet("color: gray;")
            self.mat_group.setEnabled(False)
            self.btn_save.setEnabled(False)

        except Exception as e:
            QMessageBox.warning(self, "오류", "데이터베이스 저장 중 문제가 발생했습니다.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = AdminMaterialWindow()
    window.show()
    sys.exit(app.exec())