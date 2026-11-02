import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@unittest.skipUnless(importlib.util.find_spec("PySide6"), "PySide6 is not installed")
class QuantityScannerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # No credentials or production connections are used by these GUI tests.
        fake_config = types.ModuleType("supabase_config")
        fake_config.supabase = MagicMock()
        with patch.dict(sys.modules, {"supabase_config": fake_config}):
            import station_scanner
            import admin_dashboard
            import live_dashboard
            from scan_wo import ScannerWindow
        from PySide6.QtWidgets import QApplication
        cls.app = QApplication.instance() or QApplication([])
        cls.module = station_scanner
        cls.dashboard_modules = [admin_dashboard, live_dashboard]
        cls.pouring_window = ScannerWindow

    def setUp(self):
        self.backend = MagicMock()
        self.backend_patch = patch.object(self.module, "supabase", self.backend)
        self.backend_patch.start()
        self.addCleanup(self.backend_patch.stop)
        self.window = self.module.StationScanner()
        self.addCleanup(self.window.close)
        self.order = {
            "wo_id": "WO-PARTIAL", "target_qty": 100, "quantity_confirmed": True,
            "process_quantities": dict.fromkeys(self.module.STEPS, 0),
        }
        self.backend.table.return_value.select.return_value.eq.return_value.execute.return_value = types.SimpleNamespace(data=[self.order])

    def lookup(self):
        self.window.scan_input.setText("WO-PARTIAL")
        self.window.process_scan()

    def test_scan_does_not_write_and_requires_explicit_quantity(self):
        self.lookup()
        self.backend.rpc.assert_not_called()
        self.assertEqual(self.window.quantity_input.value(), 0)
        self.assertEqual(self.window.quantity_input.maximum(), 100)
        self.window.record()
        self.backend.rpc.assert_not_called()
        updated = {**self.order, "process_quantities": {**self.order["process_quantities"], "조형": 13}}
        self.backend.rpc.return_value.execute.return_value = types.SimpleNamespace(data=updated)
        self.window.quantity_input.setValue(13)
        self.window.record()
        rpc_name, payload = self.backend.rpc.call_args.args
        self.assertEqual(rpc_name, "record_production_progress")
        self.assertEqual(payload["p_quantity"], 13)
        self.assertEqual(payload["p_step"], 0)
        self.assertEqual(self.window.quantity_input.maximum(), 87)
        self.assertEqual(self.window.quantity_input.value(), 0)

    def test_next_process_only_receives_available_quantity(self):
        self.order["process_quantities"].update({"조형": 13, "주입": 7})
        self.lookup()
        self.window.station_combo.setCurrentIndex(1)
        self.assertEqual(self.window.quantity_input.maximum(), 6)
        self.window.station_combo.setCurrentIndex(5)
        self.assertEqual(self.window.quantity_input.maximum(), 0)
        self.assertFalse(self.window.save_button.isEnabled())

    def test_routed_scanner_uses_snapshot_keys_and_recovers_after_lookup_error(self):
        self.order.update(routing_steps=[
            {"key": f"p{i}", "name": f"공정{i}"} for i in range(8)
        ], process_quantities={f"p{i}": 30 if i < 7 else 11 for i in range(8)})
        self.lookup()
        self.assertEqual(self.window.station_combo.count(), 8)
        self.window.station_combo.setCurrentIndex(7)
        self.assertEqual(self.window.quantity_input.maximum(), 19)
        self.assertIn("누적 출고 11개", self.window.info_label.text())
        response = self.backend.table.return_value.select.return_value.eq.return_value.execute
        response.return_value = types.SimpleNamespace(data=[])
        self.lookup()
        self.assertIsNone(self.window.order)
        response.return_value = types.SimpleNamespace(data=[self.order])
        self.lookup()
        self.assertEqual(self.window.station_combo.currentIndex(), 7)
        self.assertEqual(self.window.quantity_input.maximum(), 19)

    def test_url_qr_looks_up_same_order_without_recording_progress(self):
        self.window.scan_input.setText("https://test-ict.pages.dev/scanner/?wo_id=WO-PARTIAL")
        self.window.process_scan()
        self.backend.table.return_value.select.return_value.eq.assert_called_with("wo_id", "WO-PARTIAL")
        self.assertEqual(self.window.order["wo_id"], "WO-PARTIAL")
        self.backend.rpc.assert_not_called()

    def test_old_unconfirmed_order_cannot_record(self):
        self.order["quantity_confirmed"] = False
        self.lookup()
        self.assertIsNone(self.window.order)
        self.assertFalse(self.window.save_button.isEnabled())
        self.assertIn("누적 수량", self.window.info_label.text())
        self.backend.rpc.assert_not_called()

    def test_unknown_commit_result_retries_exact_same_payload(self):
        self.lookup()
        self.window.quantity_input.setValue(13)
        updated = {**self.order, "process_quantities": {**self.order["process_quantities"], "조형": 13}}
        self.backend.rpc.return_value.execute.side_effect = [
            RuntimeError("network disconnected"), types.SimpleNamespace(data=updated),
        ]
        self.window.record()
        first = self.backend.rpc.call_args.args[1].copy()
        self.assertIsNotNone(self.window.pending)
        self.assertFalse(self.window.scan_input.isEnabled())
        self.window.record()
        self.assertEqual(self.backend.rpc.call_args.args[1], first)
        self.assertIsNone(self.window.pending)
        self.assertEqual(self.window.quantity_input.maximum(), 87)

    def test_pouring_entrypoint_uses_same_six_stage_scanner(self):
        window = self.pouring_window()
        self.addCleanup(window.close)
        self.assertEqual(window.station_combo.currentIndex(), 1)
        self.assertEqual(window.station_combo.count(), 6)

    def dashboard(self, module):
        self.backend.table.return_value.select.return_value.order.return_value.execute.return_value = types.SimpleNamespace(data=[self.order])
        with patch.object(module, "supabase", self.backend):
            window_type = getattr(module, "AdminDashboard", None) or module.LiveDashboard
            window = window_type()
        self.addCleanup(window.close)
        if hasattr(window, "timer"):
            self.addCleanup(window.timer.stop)
        return window

    def test_desktop_dashboards_show_process_counts_and_shipment_remainder(self):
        self.order["current_step"] = "부분출고"
        self.order["process_quantities"].update(dict(zip(self.module.STEPS, [67, 53, 39, 31, 21, 13])))
        for module in self.dashboard_modules:
            with self.subTest(module=module.__name__):
                window = self.dashboard(module)
                self.assertEqual(window.table.item(0, 4).text(), "부분출고")
                self.assertIn("조형 67", window.table.item(0, 5).text())
                self.assertIn("포장 21", window.table.item(0, 5).text())
                self.assertEqual(window.table.item(0, 6).text(), "13 개")
                self.assertEqual(window.table.item(0, 7).text(), "87 개")

    def test_desktop_dashboards_do_not_guess_old_shipment_quantities(self):
        self.order.update(quantity_confirmed=False, current_step="출고완료")
        for module in self.dashboard_modules:
            with self.subTest(module=module.__name__):
                window = self.dashboard(module)
                self.assertEqual(window.table.item(0, 4).text(), "기존 수량 확인 필요")
                self.assertEqual(window.table.item(0, 6).text(), "—")


if __name__ == "__main__":
    unittest.main()
