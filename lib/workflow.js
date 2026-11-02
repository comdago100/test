export const steps = [
  { name: "조형", label: "조형 완료", value: "조형완료", place: "조형장" },
  { name: "주입", label: "주입 완료", value: "주입완료", place: "주입장" },
  { name: "가공", label: "가공 완료", value: "가공완료", place: "가공장" },
  { name: "검사", label: "검사 완료", value: "검사완료", place: "검사장" },
  { name: "포장", label: "포장 완료", value: "포장완료", place: "포장장" },
  { name: "출고", label: "출고 완료", value: "출고완료", place: "출고장" },
];
export function stageIndex(status) {
  if (!status) return -1;
  return steps.findIndex(step => status.includes(step.name));
}
export function getProgress(order) {
  const target = Number(order.target_qty || 0);
  const tracked = order.quantity_confirmed === true;
  const legacy = order.quantity_confirmed == null;
  const stage = stageIndex(order.current_step);
  const completed = steps.map((step, i) => tracked
    ? Number(order.process_quantities?.[step.name] || 0)
    : legacy && i <= stage ? target : 0);
  const available = completed.map((qty, i) => Math.max(0, (i === 0 ? target : completed[i - 1]) - qty));
  const shipped = completed[steps.length - 1];
  return { target, tracked, needsOpening: order.quantity_confirmed === false, completed, available,
    shipped, remaining: Math.max(0, target - shipped),
    complete: target > 0 && shipped >= target,
    started: completed.some(qty => qty > 0) || order.quantity_confirmed === false };
}
export function validateQuantity(value, available) {
  if (String(value).trim() === "") return "이번에 처리한 수량을 입력하세요.";
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) return "수량은 1 이상의 정수로 입력하세요.";
  if (quantity > available) return `처리 가능 수량 ${available.toLocaleString()}개를 초과할 수 없습니다.`;
  return "";
}
export function validateOpening(values, target) {
  let previous = Number(target);
  for (let i = 0; i < steps.length; i++) {
    const value = values[i];
    const quantity = Number(value);
    if (String(value ?? "").trim() === "" || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > previous) {
      return `${steps[i].name}의 누적 완료 수량을 0~${previous.toLocaleString()}개로 입력하세요.`;
    }
    previous = quantity;
  }
  return "";
}
export function matchesStage(order, filter) {
  if (filter === "전체") return true;
  const progress = getProgress(order);
  if (filter === "수량 확인") return progress.needsOpening;
  if (progress.needsOpening) return false;
  if (filter === "대기") return !progress.started;
  if (filter === "출고 완료") return progress.complete;
  const index = steps.findIndex(step => step.name === filter);
  return index >= 0 && progress.available[index] > 0;
}
export function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}
