import sys
import webbrowser
from uuid import uuid4
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QLineEdit, QVBoxLayout, QWidget, QLabel,
    QComboBox, QSpinBox, QPushButton,
)
from PySide6.QtGui import QFont
from PySide6.QtCore import Qt
from supabase_config import supabase
from production_quantities import STEPS, order_steps, quality_counts
from production_codes import parse_order_code, build_order_url


class StationScanner(QMainWindow):
    def __init__(self, initial_step=0):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 현장 수량 스캐너")
        self.setGeometry(200, 200, 680, 520)
        self.order = None
        self.pending = None
        self.busy = False
        self.stage_defs = order_steps(None)
        layout = QVBoxLayout()
        self.station_combo = QComboBox()
        self.station_combo.setFont(QFont("Arial", 16))
        self.station_combo.addItems([f"[{i+1}공정] {name} 완료" for i, name in enumerate(STEPS)])
        self.station_combo.setCurrentIndex(initial_step)
        self.station_combo.currentIndexChanged.connect(self.station_changed)
        layout.addWidget(self.station_combo)
        self.info_label = QLabel("작업지시서를 스캔한 뒤 이번 처리 수량을 입력하세요.")
        self.info_label.setFont(QFont("Arial", 16))
        self.info_label.setWordWrap(True)
        self.info_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.info_label)
        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText("작업지시 바코드 / 번호 입력 (엔터로 조회)")
        self.scan_input.returnPressed.connect(self.process_scan)
        layout.addWidget(self.scan_input)
        layout.addWidget(QLabel("이번 처리 수량 (개)"))
        self.quantity_input = QSpinBox()
        self.quantity_input.setRange(0, 0)
        self.quantity_input.setSpecialValueText("수량을 입력하세요")
        self.quantity_input.setFont(QFont("Arial", 20))
        layout.addWidget(self.quantity_input)
        self.note_input = QLineEdit()
        self.note_input.setPlaceholderText("메모 (출고처, 생산 회차 등 / 선택)")
        self.note_input.setMaxLength(500)
        layout.addWidget(self.note_input)
        self.save_button = QPushButton("이번 수량 기록")
        self.save_button.clicked.connect(self.record)
        self.save_button.setEnabled(False)
        layout.addWidget(self.save_button)
        self.quality_button = QPushButton("불량 등록 / 처리 (웹 화면)")
        self.quality_button.setToolTip("웹에서 불량을 기록한 뒤 PC에서 지시서를 다시 조회하세요.")
        self.quality_button.clicked.connect(self.open_quality)
        self.quality_button.setEnabled(False)
        layout.addWidget(self.quality_button)
        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)
        self.scan_input.setFocus()

    def station_changed(self):
        if self.order:
            self.show_order()
        else:
            self.scan_input.setFocus()

    def show_order(self):
        counts = self.order.get("process_quantities") or {}
        stages = order_steps(self.order)
        step = self.station_combo.currentIndex()
        target = int(self.order["target_qty"])
        done = int(counts.get(stages[step]["key"], 0))
        held, scrapped = quality_counts(self.order)
        previous = target + sum(scrapped) if step == 0 else int(counts.get(stages[step - 1]["key"], 0))
        available = min(2147483647, max(0, previous - done - held[step] - scrapped[step]))
        shipped = int(counts.get(stages[-1]["key"], 0))
        self.info_label.setText(
            f"[{self.order['wo_id']}] 목표 {target}개\n"
            f"{stages[step]['name']} 누적 {done}개 / 이번 처리 가능 {available}개\n"
            f"누적 출고 {shipped}개 / 출고 잔량 {max(0, target-shipped)}개"
            f"\n불량 보류 {sum(held)}개 / 확정 폐기 {sum(scrapped)}개"
        )
        self.info_label.setStyleSheet("color: #24523f;")
        self.quantity_input.setRange(0, available)
        self.quantity_input.setValue(0)
        self.note_input.clear()
        self.save_button.setEnabled(available > 0)
        self.quality_button.setEnabled(True)
        self.quantity_input.setFocus()

    def process_scan(self):
        if self.busy or self.pending:
            return
        previous_steps = self.stage_defs
        previous_key = previous_steps[self.station_combo.currentIndex()]["key"]
        self.order = None
        self.quality_button.setEnabled(False)
        self.quantity_input.setRange(0, 0)
        self.save_button.setEnabled(False)
        try:
            wo_id = parse_order_code(self.scan_input.text())
            if not wo_id:
                return
            response = supabase.table("work_orders").select("*").eq("wo_id", wo_id).execute()
            if not response.data:
                raise ValueError("일치하는 작업지시가 없습니다.")
            order = response.data[0]
            if order.get("quantity_confirmed") is not True:
                raise ValueError("웹 현장 스캔에서 기존 공정별 누적 수량을 먼저 확인하세요. DB 수량 관리 설정도 필요합니다.")
            self.order = order
            stages = order_steps(order)
            self.stage_defs = stages
            chosen = next((i for i, item in enumerate(stages) if item["key"] == previous_key), 0)
            self.station_combo.blockSignals(True)
            self.station_combo.clear()
            self.station_combo.addItems([f"[{i+1}공정] {item['name']} 완료" for i, item in enumerate(stages)])
            self.station_combo.setCurrentIndex(chosen)
            self.station_combo.blockSignals(False)
            self.scan_input.clear()
            self.show_order()
        except Exception as error:
            self.info_label.setText(str(error))
            self.info_label.setStyleSheet("color: red;")
            self.scan_input.setFocus()

    def record(self):
        if self.busy:
            return
        if not self.pending:
            quantity = self.quantity_input.value()
            if not self.order or quantity <= 0:
                self.info_label.setText("이번에 실제로 처리한 수량을 입력하세요.")
                return
            self.pending = {
                "p_wo_id": self.order["wo_id"],
                "p_step": self.station_combo.currentIndex(),
                "p_quantity": quantity,
                "p_request_id": str(uuid4()),
                "p_note": self.note_input.text().strip(),
            }
        self.busy = True
        self.quality_button.setEnabled(False)
        self.save_button.setEnabled(False)
        for control in (self.station_combo, self.scan_input, self.quantity_input, self.note_input):
            control.setEnabled(False)
        try:
            response = supabase.rpc("record_production_progress", self.pending).execute()
            self.order = response.data
            self.pending = None
            self.show_order()
            self.save_button.setText("이번 수량 기록")
        except Exception as error:
            code = getattr(error, "code", None)
            if code and code not in ("PGRST000", "PGRST001", "PGRST002"):
                self.pending = None
                self.save_button.setText("이번 수량 기록")
                self.info_label.setText(str(error) + "\n지시서를 다시 조회해 최신 수량을 확인하세요.")
            else:
                self.save_button.setText("같은 기록 확인 / 재시도")
                self.info_label.setText("저장 결과를 확인하지 못했습니다. 재시도 버튼으로 같은 요청을 확인하세요.")
            self.info_label.setStyleSheet("color: red;")
            self.save_button.setEnabled(True)
        finally:
            self.busy = False
            self.quality_button.setEnabled(self.pending is None and self.order is not None)
            for control in (self.station_combo, self.scan_input, self.quantity_input, self.note_input):
                control.setEnabled(self.pending is None)

    def open_quality(self):
        if self.order and not self.busy and not self.pending:
            webbrowser.open(build_order_url(self.order["wo_id"]))


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = StationScanner()
    window.show()
    sys.exit(app.exec())
