import sys
import os
import qrcode
import webbrowser
from html import escape
from datetime import datetime
from PySide6.QtWidgets import (QApplication, QMainWindow, QVBoxLayout, QHBoxLayout, 
                               QWidget, QLabel, QPushButton, QComboBox, QSpinBox, QDoubleSpinBox, QMessageBox)
from PySide6.QtGui import QFont


from supabase_config import supabase
from production_codes import build_order_url
from production_quantities import order_steps


class WorkOrderPrinter(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("에스앤더블류 - 작업지시서 발행 및 출력")
        self.setGeometry(200, 200, 450, 450)

        layout = QVBoxLayout()
        
        # 1. 거래처 선택
        layout.addWidget(QLabel("1. 거래처 선택"))
        self.combo_client = QComboBox()
        self.combo_client.setFont(QFont("Arial", 12))
        self.combo_client.addItem("수경스틸", "C-001") 
        layout.addWidget(self.combo_client)

        # 2. 생산 품목 선택
        layout.addWidget(QLabel("2. 생산 품목 선택"))
        self.combo_item = QComboBox()
        self.combo_item.setFont(QFont("Arial", 12))
        self.combo_item.addItem("선박 엔진용 캠 A형", "CAM-001")
        self.combo_item.addItem("특수 볼트", "BOLT-001")
        layout.addWidget(self.combo_item)

        # 3. 제품 단중 입력 (소수점 입력 가능)
        layout.addWidget(QLabel("3. 제품 단중 (kg)"))
        self.spin_weight = QDoubleSpinBox()
        self.spin_weight.setFont(QFont("Arial", 14))
        self.spin_weight.setRange(0.01, 10000.00)
        self.spin_weight.setValue(15.50) # 기본값
        self.spin_weight.setSuffix(" kg")
        layout.addWidget(self.spin_weight)

        # 4. 목표 생산 수량
        layout.addWidget(QLabel("4. 목표 생산 수량"))
        self.spin_qty = QSpinBox()
        self.spin_qty.setFont(QFont("Arial", 14))
        self.spin_qty.setRange(1, 10000)
        self.spin_qty.setValue(100)
        self.spin_qty.setSuffix(" 개")
        layout.addWidget(self.spin_qty)

        layout.addWidget(QLabel("5. 라우팅 선택"))
        self.combo_routing = QComboBox()
        self.routing_load_error = ""
        try:
            routes = supabase.table("production_routings").select("*").eq("is_active", True).order("routing_code").execute().data
            for route in routes:
                self.combo_routing.addItem(route["routing_name"], route)
            if not routes:
                self.routing_load_error = "웹 라우팅 관리에서 사용 가능한 라우팅을 등록하세요."
        except Exception as error:
            if getattr(error, "code", "") in ("42P01", "PGRST205"):
                self.combo_routing.addItem("기존 6공정 (라우팅 DB 설정 필요)", None)
            else:
                self.routing_load_error = "라우팅을 불러오지 못했습니다. 연결을 확인한 뒤 프로그램을 다시 열어 주세요."
        layout.addWidget(self.combo_routing)

        layout.addSpacing(20)

        # 5. 발행 버튼
        self.btn_print = QPushButton("지시서 발행 및 A4 인쇄창 열기")
        self.btn_print.setMinimumHeight(60)
        self.btn_print.setFont(QFont("Arial", 14, QFont.Bold))
        self.btn_print.setStyleSheet("background-color: #FF5722; color: white;")
        self.btn_print.clicked.connect(self.generate_and_print)
        layout.addWidget(self.btn_print)

        widget = QWidget()
        widget.setLayout(layout)
        self.setCentralWidget(widget)

    def generate_and_print(self):
        if self.routing_load_error:
            QMessageBox.warning(self, "라우팅 확인", self.routing_load_error)
            return
        now = datetime.now()
        wo_id = f"WO-{now.strftime('%y%m%d')}-{now.strftime('%H%M%S')}"
        
        client_name = self.combo_client.currentText()
        client_code = self.combo_client.currentData()
        item_name = self.combo_item.currentText()
        item_code = self.combo_item.currentData()
        unit_weight = self.spin_weight.value()
        target_qty = self.spin_qty.value()
        
        # 총 예상 중량 자동 계산 (단중 * 수량)
        total_weight = round(unit_weight * target_qty, 2)

        # 1. 품목 마스터(items) 테이블에 단중 정보 업데이트 (DB에 저장해두기 위함)
        try:
            supabase.table('items').upsert({
                "item_code": item_code,
                "item_name": item_name,
                "unit_weight": unit_weight
            }).execute()
        except:
            pass

        # 2. 작업지시서(work_orders) DB 저장
        try:
            route = self.combo_routing.currentData()
            payload = {
                "wo_id": wo_id,
                "client_code": client_code,
                "item_code": item_code,
                "target_qty": target_qty,
                "current_step": "발행대기"
            }
            if route:
                payload["routing_code"] = route["routing_code"]
            created = supabase.table('work_orders').insert(payload).execute().data[0]
            routing_name = escape(created.get("routing_name") or "기존 6공정")
            routing_flow = " → ".join(escape(stage["name"]) for stage in order_steps(created))
        except Exception as e:
            QMessageBox.warning(self, "오류", "DB 저장 중 문제가 발생했습니다.")
            return

        # 3. 현장 스캔용 QR 코드 생성
        qr_filename = f"{wo_id}.png"
        qr = qrcode.make(build_order_url(wo_id))
        qr.save(qr_filename)

        # 4. 현장 작업자용 A4 인쇄 템플릿 (단중 및 총 중량 강조)
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>작업지시서 - {wo_id}</title>
            <style>
                body {{ font-family: 'Malgun Gothic', sans-serif; padding: 40px; color: #000; }}
                h1 {{ text-align: center; font-size: 36px; text-decoration: underline; margin-bottom: 50px; }}
                table {{ width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 20px; }}
                th, td {{ border: 2px solid #333; padding: 15px; text-align: center; }}
                th {{ background-color: #f0f0f0; width: 25%; font-weight: bold; }}
                .qr-cell {{ text-align: center; width: 35%; }}
                .memo-box {{ border: 2px solid #333; height: 150px; padding: 10px; margin-top: 30px; }}
                .footer {{ margin-top: 50px; font-size: 18px; font-weight: bold; text-align: right; }}
            </style>
        </head>
        <body>
            <h1>작 업 지 시 서</h1>
            <table>
                <tr>
                    <th>지시 번호</th>
                    <td style="font-weight: bold;">{wo_id}</td>
                    <td rowspan="4" class="qr-cell">
                        <img src="{qr_filename}" width="180"><br><br>
                        <b>휴대폰으로 작업지시 열기</b>
                    </td>
                </tr>
                <tr>
                    <th>납품 거래처</th>
                    <td>{escape(client_name)}</td>
                </tr>
                <tr>
                    <th>생산 품목</th>
                    <td style="font-weight: bold; color: #D32F2F;">{escape(item_name)}</td>
                </tr>
                <tr>
                    <th>투입 중량</th>
                    <td style="font-weight: bold;">{unit_weight:,.2f} kg</td>
                </tr>
                <tr>
                    <th>목표 수량</th>
                    <td colspan="2" style="font-size: 26px; font-weight: bold; color: #1976D2;">{target_qty:,} 개</td>
                </tr>
                <tr>
                    <th>쇳물 총 필요량<br>(예상 중량)</th>
                    <td colspan="2" style="font-size: 28px; font-weight: bold; color: #2E7D32;">{total_weight:,.2f} kg</td>
                </tr>
            </table>
            
            <p><b>라우팅: {routing_name}</b><br>{routing_flow}</p>
            <div class="memo-box">
                <b>[현장 작업 메모 및 특이사항]</b>
            </div>

            <div class="footer">
                발행 일자 : {now.strftime("%Y-%m-%d %H:%M")}<br>
                에스앤더블류 생산관리팀
            </div>
        </body>
        </html>
        """

        html_filename = f"{wo_id}.html"
        with open(html_filename, "w", encoding="utf-8") as f:
            f.write(html_content)

        webbrowser.open(f'file://{os.path.realpath(html_filename)}')
        QMessageBox.information(self, "성공", "작업지시서가 발행되었습니다.\n브라우저 창이 열리면 인쇄(Ctrl+P)를 진행해 주세요.")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = WorkOrderPrinter()
    window.show()
    sys.exit(app.exec())
