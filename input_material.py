import sys
from PySide6.QtWidgets import (QApplication, QMainWindow, QLineEdit, QVBoxLayout, 
                               QHBoxLayout, QWidget, QLabel, QPushButton, QSpinBox, QMessageBox, QGroupBox)
from PySide6.QtGui import QFont
from PySide6.QtCore import Qt


from supabase_config import supabase


class MeltingWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("용해/주입장 - 원자재 투입 스캐너")
        self.setGeometry(150, 150, 600, 500)

        # 프로그램 실행 시 기초 원자재 목록 자동 생성
        self.setup_raw_materials()
        self.current_wo_id = None

        layout = QVBoxLayout()

        # 1. 바코드 스캔 영역
        scan_label = QLabel("1. 지시서 바코드를 스캔하세요")
        scan_label.setFont(QFont("Arial", 16, QFont.Bold))
        layout.addWidget(scan_label)

        self.scan_input = QLineEdit()
        self.scan_input.setFont(QFont("Arial", 16))
        self.scan_input.setPlaceholderText("바코드 스캔 (엔터)")
        self.scan_input.returnPressed.connect(self.process_scan)
        layout.addWidget(self.scan_input)

        self.status_label = QLabel("바코드 대기 중...")
        self.status_label.setStyleSheet("color: blue; font-size: 14px;")
        layout.addWidget(self.status_label)

        # 2. 원자재 입력 영역 (바코드를 찍기 전에는 조작 불가 상태로 막아둠)
        self.mat_group = QGroupBox("2. 투입된 원자재 중량 입력")
        self.mat_group.setFont(QFont("Arial", 14, QFont.Bold))
        mat_layout = QVBoxLayout()

        self.mat_inputs = {}
        # 현장에서 주로 쓰일 원자재 목록
        materials = [("RAW-001", "고철A"), ("RAW-002", "선철"), ("RAW-003", "구상화제")]
        
        for code, name in materials:
            row = QHBoxLayout()
            lbl = QLabel(name)
            lbl.setFont(QFont("Arial", 14))
            
            spin = QSpinBox()
            spin.setRange(0, 10000) # 최대 10,000kg까지 입력 가능
            spin.setSuffix(" kg")
            spin.setFont(QFont("Arial", 16))
            spin.setMinimumHeight(40)
            
            row.addWidget(lbl)
            row.addWidget(spin)
            mat_layout.addLayout(row)
            
            self.mat_inputs[code] = spin

        self.mat_group.setLayout(mat_layout)
        self.mat_group.setEnabled(False) # 비활성화
        layout.addWidget(self.mat_group)

        # 3. 저장 버튼
        self.btn_save = QPushButton("데이터 저장 및 주입 완료 처리")
        self.btn_save.setMinimumHeight(60)
        self.btn_save.setFont(QFont("Arial", 16, QFont.Bold))
        self.btn_save.setStyleSheet("background-color: #4CAF50; color: white;")
        self.btn_save.setEnabled(False)
        self.btn_save.clicked.connect(self.save_data)
        layout.addWidget(self.btn_save)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)
        
        # 커서를 스캔창에 고정
        self.scan_input.setFocus()

    def setup_raw_materials(self):
        materials = [
            {"raw_code": "RAW-001", "raw_name": "고철A", "unit": "kg"},
            {"raw_code": "RAW-002", "raw_name": "선철", "unit": "kg"},
            {"raw_code": "RAW-003", "raw_name": "구상화제", "unit": "kg"}
        ]
        for m in materials:
            try:
                supabase.table('raw_materials').insert(m).execute()
            except:
                pass # 이미 등록되어 있으면 무시

    def process_scan(self):
        wo_id = self.scan_input.text().strip()
        if not wo_id: return

        # 스캔한 바코드가 진짜 있는 지시서인지 DB 확인
        response = supabase.table('work_orders').select("*").eq("wo_id", wo_id).execute()
        if len(response.data) > 0:
            self.current_wo_id = wo_id
            self.status_label.setText(f"[{wo_id}] 확인됨. 원자재 투입량을 입력해 주세요.")
            self.status_label.setStyleSheet("color: blue; font-size: 14px;")
            
            # 하단 입력창 및 버튼 활성화
            self.mat_group.setEnabled(True)
            self.btn_save.setEnabled(True)
            self.scan_input.setEnabled(False)
        else:
            self.status_label.setText("없는 지시서입니다. 다시 확인하세요.")
            self.status_label.setStyleSheet("color: red; font-size: 14px;")
            self.scan_input.clear()
            self.scan_input.setFocus()

    def save_data(self):
        if not self.current_wo_id: return

        try:
            # 1. 각 원자재별 투입량이 0보다 크면 material_usage 테이블에 기록
            for code, spin in self.mat_inputs.items():
                qty = spin.value()
                if qty > 0:
                    supabase.table('material_usage').insert({
                        "wo_id": self.current_wo_id,
                        "raw_code": code,
                        "input_qty": qty
                    }).execute()

            # 2. 작업지시서의 현재 상태를 '주입완료(자재투입)'으로 변경
            supabase.table('work_orders').update({"current_step": "주입완료(자재투입)"}).eq("wo_id", self.current_wo_id).execute()

            QMessageBox.information(self, "성공", "투입량 기록이 완료되었습니다.")
            
            # 3. 다음 바코드를 찍을 수 있도록 화면 전체 초기화
            self.current_wo_id = None
            for spin in self.mat_inputs.values():
                spin.setValue(0)
            
            self.mat_group.setEnabled(False)
            self.btn_save.setEnabled(False)
            self.scan_input.setEnabled(True)
            self.scan_input.clear()
            self.scan_input.setFocus()
            self.status_label.setText("바코드 대기 중...")

        except Exception as e:
            QMessageBox.warning(self, "오류", "저장 중 문제가 발생했습니다.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MeltingWindow()
    window.show()
    sys.exit(app.exec())