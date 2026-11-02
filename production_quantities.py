"""Shared quantity display for the desktop production screens."""

STEPS = ["조형", "주입", "가공", "검사", "포장", "출고"]


def display_quantities(order):
    if order.get("quantity_confirmed") is not True:
        return "기존 수량 확인 필요", "웹 현장 스캔에서 누적 수량 확인", "—", "—"
    quantities = order.get("process_quantities") or {}
    target = int(order.get("target_qty") or 0)
    shipped = int(quantities.get("출고", 0))
    labels = [f"{name} {int(quantities.get(name, 0)):,}" for name in STEPS]
    summary = " · ".join(labels[:3]) + "\n" + " · ".join(labels[3:])
    return (
        order.get("current_step") or "발행대기",
        summary,
        f"{shipped:,} 개",
        f"{max(0, target - shipped):,} 개",
    )
