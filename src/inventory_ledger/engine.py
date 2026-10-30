"""품목별 수량/원 단위 금액 계산. 검증 내역은 UI에만 전달한다."""
from collections import defaultdict
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN
from itertools import groupby

import numpy as np

from .loader import ExcelLoadError, read_records
from .models import CATEGORIES, ROLES, END, START, ZERO, Entry, Issue, Record, Result, file_kind, won

ORDER = {"기초이월": 0, "입고": 1, "출고": 2, "기말재고": 3}


def business_day(day: date, forward=True) -> date:
    # 달력 기준은 월~금이다. 원본 거래일은 변경하지 않는다.
    return np.busday_offset(day.isoformat(), 0, roll="forward" if forward else "backward").astype(date)


def ordered(entries: list[Entry]) -> list[Entry]:
    return sorted(entries, key=lambda entry: (entry.record.day, ORDER[entry.kind]))


def total(records: list[Record], field: str) -> Decimal:
    return sum((getattr(r, field) for r in records), ZERO)


def snapshot(records: list[Record], template: Record, day: date) -> Record:
    qty, amount = total(records, "qty"), total(records, "amount")
    return replace(template, day=day, qty=qty, amount=amount, price=amount / qty if qty else ZERO)


def input_details(grouped, key, category: str) -> str:
    details = []
    for role in ROLES:
        records = grouped[role][key]
        details.append(f"[{file_kind(category, role)}] 정수화 합계: 수량={total(records, 'qty')}, 금액={total(records, 'amount')}")
        details.extend(record.source.describe() for record in records[:3] if record.source)
        if len(records) > 3:
            details.append(f"동일 품목 추가 {len(records) - 3}건")
    return "\n".join(details)


def material_entries(opening: Record, trades: list[Record], closing: Record) -> list[Entry]:
    required = opening.qty + total(trades, "qty") - closing.qty
    amount_required = opening.amount + total(trades, "amount") - closing.amount
    if required < 0:
        raise ValueError("수량 역전: 이월수량 + 입고수량 합계 < 재고수량")
    if amount_required < 0:
        raise ValueError("금액 역전: 이월금액 + 입고금액 합계 < 재고금액")
    if not required and amount_required:
        raise ValueError("출고수량이 0이나 출고금액이 존재합니다")
    entries = [Entry(opening, "기초이월"), *(Entry(r, "입고") for r in trades)]
    last_day = business_day(END, forward=False)
    batches = [r for r in [opening, *trades] if r.qty and business_day(r.day) <= last_day]
    eligible = total(batches, "qty")
    if required > eligible:
        raise ValueError("연말 입고일 이후 2022년 영업일이 없어 필요한 출고수량을 배치할 수 없습니다")
    released = ZERO
    quantum = Decimal(1) if all(r.qty == r.qty.to_integral_value() for r in [opening, closing, *trades]) else Decimal("0.000001")
    for index, batch in enumerate(batches):
        qty = required - released if index == len(batches) - 1 else (required * batch.qty / eligible).quantize(
            quantum, rounding=ROUND_DOWN)
        released += qty
        first = business_day(batch.day)
        dates = sorted({min(last_day, business_day(first + timedelta(days=offset))) for offset in (0, 7, 14)})
        chunk = (qty / len(dates)).quantize(quantum, rounding=ROUND_DOWN)
        assigned = ZERO
        for pos, day in enumerate(dates):
            part = qty - assigned if pos == len(dates) - 1 else chunk
            assigned += part
            if part:
                entries.append(Entry(replace(batch, day=day, qty=part, amount=ZERO, price=ZERO), "출고"))
    entries = ordered(entries)
    qty, amount = ZERO, ZERO
    outgoing = [entry for entry in entries if entry.kind == "출고"]
    for entry in entries:
        if entry.kind == "출고":
            if entry.record.qty > qty:
                raise ValueError("일자별 마이너스 재고가 발생합니다")
            price = amount / qty if qty else ZERO
            value = min(amount, won(price * entry.record.qty))
            entry.record = replace(entry.record, price=price, amount=value)
            qty -= entry.record.qty
            amount -= value
        else:
            qty += entry.record.qty
            amount += entry.record.amount
    delta = amount_required - sum((entry.record.amount for entry in outgoing), ZERO)
    if delta:
        if not outgoing or abs(delta) > max(1, len(outgoing)):
            raise ValueError("기말재고 금액이 이동평균 평가금액과 일치하지 않습니다 (원 단위 단수 범위 초과)")
        final = outgoing[-1]
        if final.record.amount + delta < 0:
            raise ValueError("마지막 출고금액이 음수입니다")
        final.record = replace(final.record, amount=final.record.amount + delta)
    return [*entries, Entry(closing, "기말재고")]


def product_entries(opening: Record, trades: list[Record], closing: Record) -> list[Entry]:
    required = closing.qty + total(trades, "qty") - opening.qty
    if required < 0:
        raise ValueError("수량 역전: 재고수량 + 출고수량 합계 < 이월수량")
    price = closing.amount / closing.qty if closing.qty else opening.amount / opening.qty if opening.qty else ZERO
    entries = [Entry(opening, "기초이월")]
    balance, received = opening.qty, ZERO
    for day, rows in groupby(sorted(trades, key=lambda r: r.day), key=lambda r: r.day):
        daily = list(rows)
        shortage = max(ZERO, total(daily, "qty") - balance)
        if shortage:
            entries.append(Entry(replace(daily[0], day=day, qty=shortage, price=price, amount=won(shortage * price)), "입고"))
            balance += shortage
            received += shortage
        for trade in daily:
            entries.append(Entry(replace(trade, price=price, amount=won(trade.qty * price)), "출고"))
            balance -= trade.qty
    if required > received:
        qty = required - received
        entries.append(Entry(replace(closing, day=business_day(END, forward=False), qty=qty,
                                     price=price, amount=won(qty * price)), "입고"))
    entries = ordered(entries)
    # 기초와 기말의 평가단가 차이도 마지막 실거래 금액에 반영한다.
    # 큰 평가 차이는 calculate()에서 UI 확인 항목으로 전달한다.
    current = opening.amount + sum((e.record.amount * (-1 if e.kind == "출고" else 1)
                                   for e in entries if e.kind in ("입고", "출고")), ZERO)
    delta = closing.amount - current
    movements = [entry for entry in entries if entry.kind in ("입고", "출고") and entry.record.qty]
    if delta:
        if not movements:
            raise ValueError("입출고수량이 없어 기초·기말 금액 차이를 반영할 수 없습니다")
        final = movements[-1]
        value = final.record.amount + (delta if final.kind == "입고" else -delta)
        if value < 0:
            raise ValueError("기초·기말 평가단가 차이로 마지막 거래금액이 음수입니다")
        final.record = replace(final.record, amount=value)
    return [*entries, Entry(closing, "기말재고")]


def verify(entries: list[Entry]) -> None:
    qty, amount = ZERO, ZERO
    previous = None
    for entry in entries:
        record = entry.record
        order = record.day, ORDER[entry.kind]
        if previous is not None and order < previous:
            raise ValueError("일자 또는 기초이월 → 입고 → 출고 순서가 올바르지 않습니다")
        previous = order
        if not START <= record.day <= END or record.qty < 0 or record.amount < 0:
            raise ValueError("거래 일자·수량·금액 범위가 올바르지 않습니다")
        if entry.kind == "기말재고":
            if qty != record.qty or amount != record.amount:
                raise ValueError("기말재고 수량 또는 금액이 수불 합계와 일치하지 않습니다")
        else:
            sign = -1 if entry.kind == "출고" else 1
            qty += sign * record.qty
            amount += sign * record.amount
        if qty < 0 or amount < 0:
            raise ValueError(f"{record.day}: 잔여 재고 수량 또는 금액이 음수입니다")
        if not qty and amount:
            raise ValueError(f"{record.day}: 재고수량이 0이나 재고금액이 남습니다")
        entry.balance_qty, entry.balance_amount = qty, amount


def calculate(data: dict[tuple[str, str], list[Record]], progress=None) -> Result:
    result = Result()
    for index, category in enumerate(CATEGORIES):
        missing = [role for role in ROLES if (category, role) not in data]
        if missing:
            result.issues.append(Issue("오류", category, "", "파일 누락: " + ", ".join(missing)))
            continue
        grouped = {role: defaultdict(list) for role in ROLES}
        for role in ROLES:
            for record in data[category, role]:
                grouped[role][record.item_key(category)].append(record)
        keys = set().union(*(set(g) for g in grouped.values()))
        result.ledgers[category] = []
        if not keys:
            result.issues.append(Issue("확인", category, "", "등록된 품목이 없습니다"))
        for key in sorted(keys):
            item = " / ".join(key)
            absent = [role for role in ROLES if key not in grouped[role]]
            if absent:
                result.issues.append(Issue("확인", category, item, "품목 미일치: " + ", ".join(file_kind(category, r) for r in absent)
                                           + " 파일에 없음 (해당 내역 0으로 처리)\n" + input_details(grouped, key, category)))
            source = [r for role in ROLES for r in grouped[role][key]]
            if len({r.unit for r in source if r.unit}) > 1:
                result.issues.append(Issue("오류", category, item, "파일 간 단위가 다릅니다\n" + input_details(grouped, key, category)))
                continue
            opening = snapshot(grouped["이월"][key], source[0], START)
            closing = snapshot(grouped["재고"][key], source[0], END)
            trades = sorted(grouped["거래"][key], key=lambda r: r.day)
            try:
                entries = (product_entries if category == "제품" else material_entries)(opening, trades, closing)
                verify(entries)
                result.ledgers[category].append(entries)
                if category == "제품":
                    differences = [e.record.amount - won(e.record.qty * e.record.price) for e in entries if e.kind in ("입고", "출고")]
                    if any(abs(value) > 1 for value in differences):
                        result.issues.append(Issue("확인", category, item, "기초·기말 평가단가 차이가 마지막 거래금액에 반영되었습니다. 평가 기준을 확인해 주세요."))
                    if not opening.amount and not closing.amount and total(trades, "qty"):
                        result.issues.append(Issue("확인", category, item, "기초·기말 기준단가가 0이므로 거래금액이 0원입니다."))
            except ValueError as exc:
                kinds = "/".join(file_kind(category, role) for role in ROLES if grouped[role][key])
                result.issues.append(Issue("오류", category, f"[{kinds}] {item}", str(exc) + "\n" + input_details(grouped, key, category)))
        if progress:
            progress(65 + (index + 1) * 8, f"{category} 수불 검증 완료")
    if result.valid:
        result.issues.append(Issue("정상", "전체", "", "수량·금액 일치 / 일자별 마이너스 재고 0건 / 동일 일자 거래 순서 정상"))
    return result


def load_and_calculate(paths: dict[tuple[str, str], str], progress=None) -> Result:
    data, issues = {}, []
    for index, (category, role) in enumerate((c, r) for c in CATEGORIES for r in ROLES):
        path = paths.get((category, role))
        if not path:
            issues.append(Issue("오류", category, file_kind(category, role), "파일을 선택해 주세요"))
        else:
            try:
                data[category, role] = read_records(path, role, category)
            except ExcelLoadError as exc:
                issues.extend(exc.issues)
            except Exception as exc:
                issues.append(Issue("오류", category, file_kind(category, role), f"[{file_kind(category, role)}] 파일: {path} / 오류: {exc}"))
        if progress:
            progress((index + 1) * 7, f"{category} {role} 파일 확인")
    return Result(issues=issues) if issues else calculate(data, progress)
