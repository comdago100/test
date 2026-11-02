"""URLs shared by the desktop QR printer and barcode inputs."""

import re
from urllib.parse import parse_qs, urlencode, urlsplit

PRODUCTION_ORIGIN = "https://test-ict.pages.dev"


def validate_order_id(value):
    if not value or len(value) > 80 or re.search(r"\s", value):
        raise ValueError("작업지시 번호는 공백 없이 80자 이내로 입력하세요.")
    return value


def build_order_url(order_id):
    order_id = validate_order_id(str(order_id).strip())
    return PRODUCTION_ORIGIN + "/scanner/?" + urlencode({"wo_id": order_id})


def parse_order_code(raw):
    value = str(raw or "").strip()
    if not value:
        return ""
    if "://" in value or re.match(r"https?:", value, re.I):
        try:
            url = urlsplit(value)
            host = url.hostname or ""
            params = parse_qs(url.query, keep_blank_values=True)
            known_host = host == "test-ict.pages.dev" or host.endswith(".test-ict.pages.dev") or host in ("localhost", "127.0.0.1", "::1")
            if url.scheme not in ("https", "http") or not known_host or url.username or url.password or url.path.rstrip("/") != "/scanner" or len(params.get("wo_id", [])) != 1:
                raise ValueError("지원하는 작업지시 QR 주소가 아닙니다.")
            value = params["wo_id"][0].strip()
        except ValueError as error:
            raise ValueError("작업지시 QR 주소를 확인해 주세요.") from error
    return validate_order_id(value)
