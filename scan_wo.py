import sys
from PySide6.QtWidgets import QApplication
from station_scanner import StationScanner


class ScannerWindow(StationScanner):
    def __init__(self):
        super().__init__(initial_step=1)
        self.setWindowTitle("현장 수량 스캐너 - 주입 공정")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = ScannerWindow()
    window.show()
    sys.exit(app.exec())
