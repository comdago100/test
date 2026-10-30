"""Supabase connection settings from environment or a local .env file."""
import os
from pathlib import Path

from supabase import create_client


def _load_local_env():
    path = Path(__file__).resolve().parent / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name in {"SUPABASE_URL", "SUPABASE_KEY"}:
            os.environ.setdefault(name, value.strip().strip("\"'"))


_load_local_env()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
if not url or not key:
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY in environment or local .env")
supabase = create_client(url, key)
