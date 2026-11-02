import unittest
from production_codes import build_order_url, parse_order_code


class ProductionCodesTest(unittest.TestCase):
    def test_phone_opens_production_order(self):
        self.assertEqual(build_order_url("test"), "https://test-ict.pages.dev/scanner/?wo_id=test")

    def test_ids_round_trip_without_losing_special_characters(self):
        for order_id in ("WO-001", "지시-001", "WO+A&B#1", "WO/001?A"):
            with self.subTest(order_id=order_id):
                self.assertEqual(parse_order_code(build_order_url(order_id)), order_id)

    def test_legacy_plain_ids_remain_valid(self):
        self.assertEqual(parse_order_code("  test  "), "test")
        self.assertEqual(parse_order_code(""), "")

    def test_invalid_urls_are_rejected(self):
        for value in (
            "https://example.com/scanner/?wo_id=test",
            "https://test-ict.pages.dev.evil.example/scanner/?wo_id=test",
            "https://test-ict.pages.dev/orders/?wo_id=test",
            "https://test-ict.pages.dev/scanner/",
            "https://test-ict.pages.dev/scanner/?wo_id=",
            "https://test-ict.pages.dev/scanner/?wo_id=A&wo_id=B",
            "ftp://test-ict.pages.dev/scanner/?wo_id=test",
            "https://user:pass@test-ict.pages.dev/scanner/?wo_id=test",
            "bad id", "A" * 81,
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_order_code(value)
