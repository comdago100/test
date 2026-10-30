from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

CATEGORIES = ("원재료", "부재료", "제품")
ROLES = ("이월", "거래", "재고")
START = date(2022, 1, 1)
END = date(2022, 12, 31)
ZERO = Decimal(0)


def won(value: Decimal) -> Decimal:
    return value.quantize(Decimal(1), rounding=ROUND_HALF_UP)


def file_kind(category: str, role: str) -> str:
    return ("출고" if category == "제품" else "입고") if role == "거래" else role


@dataclass(frozen=True)
class Source:
    filename: str
    kind: str
    excel_row: int
    values: tuple[tuple[str, str], ...]

    def describe(self) -> str:
        values = ", ".join(f"{key}={value}" for key, value in self.values)
        return f"[{self.kind}] {self.filename} / 엑셀 {self.excel_row}행 / 읽은 값: {values}"


@dataclass(frozen=True)
class Record:
    name: str
    spec: str
    unit: str
    day: date
    qty: Decimal
    price: Decimal
    amount: Decimal
    factory: str = ""
    source: Source | None = None

    @property
    def key(self) -> tuple[str, str, str]:
        return self.factory, self.name, self.spec

    def item_key(self, category: str) -> tuple[str, ...]:
        if category == "원재료":
            return (self.name,)
        if category == "제품":
            return self.key
        return self.name, self.spec


@dataclass
class Issue:
    level: str
    category: str
    item: str
    message: str


@dataclass
class Entry:
    record: Record
    kind: str
    balance_qty: Decimal = ZERO
    balance_amount: Decimal = ZERO


@dataclass
class Result:
    ledgers: dict[str, list[list[Entry]]] = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return bool(self.ledgers) and not any(i.level == "오류" for i in self.issues)
