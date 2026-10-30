import sys
from pathlib import Path

from PySide6.QtCore import QObject, QThread, Signal, Slot
from PySide6.QtWidgets import (QApplication, QCheckBox, QFileDialog, QGridLayout, QGroupBox,
    QHBoxLayout, QHeaderView, QLabel, QLineEdit, QMainWindow, QMessageBox, QPushButton,
    QTabWidget, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget, QProgressBar)

from .engine import load_and_calculate
from .exporter import export_workbook
from .models import CATEGORIES, ROLES, Result


class Worker(QObject):
    done = Signal(object, str)
    progress = Signal(int, str)

    def __init__(self, paths, output=None, company="", approval=True):
        super().__init__()
        self.paths, self.output, self.company, self.approval = paths, output, company, approval

    @Slot()
    def run(self):
        try:
            result = load_and_calculate(self.paths, self.progress.emit)
            if self.output and result.valid:
                export_workbook(result, self.output, self.company, self.approval, self.progress.emit)
            self.progress.emit(100, "검증 완료" if not self.output else "처리 완료")
            self.done.emit(result, "")
        except Exception as exc:
            self.done.emit(None, str(exc))


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("2022년 제조업 재고수불부")
        self.resize(1180, 820)
        self.thread = None
        self.validated = False
        self.slots = {}
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        options = QHBoxLayout()
        options.addWidget(QLabel("회사명"))
        self.company = QLineEdit()
        self.company.setPlaceholderText("인쇄할 회사명을 입력해 주세요")
        options.addWidget(self.company)
        self.approval = QCheckBox("결재란 표시")
        self.approval.setChecked(True)
        options.addWidget(self.approval)
        self.folder_button = QPushButton("폴더 일괄 로드")
        self.folder_button.clicked.connect(self.load_folder)
        options.addWidget(self.folder_button)
        layout.addLayout(options)
        box = QGroupBox("입력 엑셀 파일 (.xlsx / .xlsm)")
        grid = QGridLayout(box)
        grid.addWidget(QLabel("계정"), 0, 0)
        for col, label in enumerate(("이월 · 2022-01-01", "입고 / 출고 · 2022년", "재고 · 2022-12-31"), 1):
            grid.addWidget(QLabel(label), 0, col)
        self.select_buttons = []
        for row, category in enumerate(CATEGORIES, 1):
            grid.addWidget(QLabel(category), row, 0)
            for col, role in enumerate(ROLES, 1):
                slot = QWidget()
                slot_layout = QVBoxLayout(slot)
                path = QLineEdit()
                path.setPlaceholderText("파일 경로")
                button = QPushButton("출고 파일 선택" if category == "제품" and role == "거래" else "입고 파일 선택" if role == "거래" else f"{role} 파일 선택")
                button.clicked.connect(lambda checked=False, c=category, r=role: self.choose(c, r))
                self.select_buttons.append(button)
                slot_layout.addWidget(path)
                slot_layout.addWidget(button)
                grid.addWidget(slot, row, col)
                self.slots[category, role] = path
                path.textChanged.connect(self.invalidate)
        layout.addWidget(box)
        help_label = QLabel("첫 시트의 첫 행이 열 제목이어야 합니다. 폴더 파일명 예: 원재료_이월.xlsx, 원재료_입고.xlsx, 제품_출고.xlsx")
        help_label.setWordWrap(True)
        layout.addWidget(help_label)
        self.tabs = QTabWidget()
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["결과", "계정", "품목", "검증 내용"])
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.tabs.addTab(self.table, "데이터 검증 결과")
        layout.addWidget(self.tabs, 1)
        self.status = QLabel("9개 파일을 선택한 뒤 사전 검증을 실행해 주세요.")
        layout.addWidget(self.status)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        layout.addWidget(self.progress)
        actions = QHBoxLayout()
        self.validate_button = QPushButton("1단계: 데이터 검증 실행")
        self.validate_button.clicked.connect(lambda: self.start())
        self.export_button = QPushButton("2단계: 인쇄용 수불장 엑셀 생성")
        self.export_button.setEnabled(False)
        self.export_button.clicked.connect(self.save)
        actions.addWidget(self.validate_button)
        actions.addWidget(self.export_button)
        layout.addLayout(actions)

    @Slot()
    def invalidate(self):
        self.validated = False
        self.export_button.setEnabled(False)
        self.progress.setValue(0)
        self.status.setText("입력 파일이 변경되었습니다. 1단계 데이터 검증을 실행해 주세요.")

    def choose(self, category, role):
        path, _ = QFileDialog.getOpenFileName(self, "엑셀 선택", "", "Excel (*.xlsx *.xlsm)")
        if path:
            self.slots[category, role].setText(path)

    def load_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "입력 파일 폴더")
        if not folder:
            return
        files = [p for p in Path(folder).iterdir() if p.suffix.lower() in (".xlsx", ".xlsm") and not p.name.startswith("~$")]
        messages = []
        for (category, role), slot in self.slots.items():
            marker = ("출고" if category == "제품" else "입고") if role == "거래" else role
            candidates = [p for p in files if category in p.stem and marker in p.stem]
            if len(candidates) == 1:
                slot.setText(str(candidates[0]))
            else:
                slot.clear()
                messages.append(f"{category} {marker}: " + ("파일 없음" if not candidates else "여러 파일이므로 개별 선택 필요"))
        self.status.setText(" / ".join(messages) if messages else "9개 파일을 불러왔습니다.")

    def save(self):
        if not self.validated:
            self.status.setText("먼저 1단계 데이터 검증을 실행해 주세요.")
            return
        if not self.company.text().strip():
            QMessageBox.information(self, "회사명", "회사명을 입력해 주세요.")
            return
        path, _ = QFileDialog.getSaveFileName(self, "수불장 저장", "2022년도_재고수불부.xlsx", "Excel (*.xlsx)")
        if path:
            if not path.lower().endswith(".xlsx"):
                path += ".xlsx"
            inputs = {Path(s.text().strip()).resolve() for s in self.slots.values() if s.text().strip()}
            if Path(path).resolve() in inputs:
                QMessageBox.warning(self, "저장 경로", "입력 파일과 다른 저장 경로를 선택해 주세요.")
                return
            self.start(path)

    def start(self, output=None):
        if self.thread is not None:
            return
        self.output = output
        self.thread = QThread(self)
        self.worker = Worker({key: slot.text().strip() for key, slot in self.slots.items()}, output,
                             self.company.text().strip(), self.approval.isChecked())
        self.worker.moveToThread(self.thread)
        self.worker.progress.connect(self.update_progress)
        self.thread.started.connect(self.worker.run)
        self.worker.done.connect(self.complete)
        self.worker.done.connect(self.thread.quit)
        self.worker.done.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.finished.connect(self.finished)
        self.busy(True)
        self.progress.setValue(0)
        self.status.setText("파일을 읽고 수량·금액을 검증하고 있습니다…")
        self.thread.start()

    def busy(self, value):
        for widget in [self.company, self.approval, self.folder_button, self.validate_button,
                       self.export_button, *self.slots.values(), *self.select_buttons]:
            widget.setEnabled(not value)
        self.export_button.setEnabled(not value and self.validated)

    @Slot(int, str)
    def update_progress(self, value, message):
        self.progress.setValue(value)
        self.status.setText(message)

    @Slot(object, str)
    def complete(self, result: Result | None, error: str):
        self.table.setRowCount(0)
        self.validated = bool(result and result.valid)
        if error:
            self.status.setText("처리 실패")
            QMessageBox.warning(self, "처리 오류", error)
            return
        for issue in result.issues:
            row = self.table.rowCount()
            self.table.insertRow(row)
            for col, value in enumerate((issue.level, issue.category, issue.item, issue.message)):
                cell = QTableWidgetItem(value)
                cell.setToolTip(value)
                self.table.setItem(row, col, cell)
        self.table.resizeColumnsToContents()
        self.table.resizeRowsToContents()
        for row in range(self.table.rowCount()):
            self.table.setRowHeight(row, min(160, self.table.rowHeight(row)))
        if not result.valid:
            self.status.setText("검증 오류가 있습니다. 원본 파일을 확인해 주세요.")
        elif self.output:
            self.status.setText(f"저장 완료: {self.output}")
            QMessageBox.information(self, "저장 완료", f"인쇄용 수불장을 저장했습니다.\n{self.output}")
        else:
            self.status.setText("검증 완료. '확인' 항목의 재질·공장·품명·규격을 확인한 뒤 2단계로 진행해 주세요.")

    @Slot()
    def finished(self):
        self.thread = None
        self.busy(False)

    def closeEvent(self, event):
        if self.thread is not None:
            self.status.setText("진행 중인 작업이 끝나면 창을 닫아 주세요.")
            event.ignore()
        else:
            event.accept()


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = MainWindow()
    window.show()
    return app.exec()
