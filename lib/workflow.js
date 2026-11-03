export const steps = [
  { name: "조형", label: "조형 완료", value: "조형완료", place: "조형장" },
  { name: "주입", label: "주입 완료", value: "주입완료", place: "주입장" },
  { name: "가공", label: "가공 완료", value: "가공완료", place: "가공장" },
  { name: "검사", label: "검사 완료", value: "검사완료", place: "검사장" },
  { name: "포장", label: "포장 완료", value: "포장완료", place: "포장장" },
  { name: "출고", label: "출고 완료", value: "출고완료", place: "출고장" },
];
export function getOrderSteps(order) {
  const source = Array.isArray(order?.routing_steps) && order.routing_steps.length ? order.routing_steps : steps;
  return source.map((step, i) => ({ ...step, key: step.key || step.name,
    label: step.name + " 완료", value: step.name + "완료", place: step.place || step.name,
    role: step.role || (i === source.length - 1 ? "shipment" : step.name === "검사" ? "inspection" : "production") }));
}
export function stageIndex(status, stages = steps) {
  if (!status) return -1;
  return stages.findIndex(step => status.includes(step.name));
}
export function getProgress(order) {
  const stages = getOrderSteps(order);
  const target = Number(order.target_qty || 0);
  const tracked = order.quantity_confirmed === true;
  const legacy = order.quantity_confirmed == null;
  const stage = stageIndex(order.current_step, stages);
  const completed = stages.map((step, i) => tracked
    ? Number(order.process_quantities?.[step.key] || 0)
    : legacy && i <= stage ? target : 0);
  const held = stages.map(step => Number(order.quality_quantities?.[step.key]?.held || 0));
  const scrapped = stages.map(step => Number(order.quality_quantities?.[step.key]?.scrapped || 0));
  const scrapTotal = scrapped.reduce((sum,qty) => sum+qty,0);
  const heldTotal = held.reduce((sum,qty) => sum+qty,0);
  const available = completed.map((qty, i) => Math.max(0, (i === 0 ? target+scrapTotal : completed[i - 1]) - qty - held[i] - scrapped[i]));
  const defectAvailable = completed.map((qty,i) => i===stages.length-1 ? 0 : Math.max(0,qty-completed[i+1]-held[i+1]-scrapped[i+1]));
  const shipped = completed[stages.length - 1];
  return { steps: stages, target, tracked, needsOpening: order.quantity_confirmed === false, completed, available,
    held, scrapped, heldTotal, scrapTotal, defectAvailable, productionAllowance:target+scrapTotal,
    shipped, remaining: Math.max(0, target - shipped),
    complete: target > 0 && shipped >= target,
    started: completed.some(qty => qty > 0) || heldTotal>0 || scrapTotal>0 || order.quantity_confirmed === false };
}
export function validateQuantity(value, available) {
  if (String(value).trim() === "") return "이번에 처리한 수량을 입력하세요.";
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) return "수량은 1 이상의 정수로 입력하세요.";
  if (quantity > available) return `처리 가능 수량 ${available.toLocaleString()}개를 초과할 수 없습니다.`;
  return "";
}
export function validateOpening(values, target, stages = steps) {
  let previous = Number(target);
  for (let i = 0; i < stages.length; i++) {
    const value = values[i];
    const quantity = Number(value);
    if (String(value ?? "").trim() === "" || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > previous) {
      return `${stages[i].name}의 누적 완료 수량을 0~${previous.toLocaleString()}개로 입력하세요.`;
    }
    previous = quantity;
  }
  return "";
}
export function matchesStage(order, filter) {
  if (filter === "전체") return true;
  const progress = getProgress(order);
  if (filter === "수량 확인") return progress.needsOpening;
  if (filter === "불량 보류") return progress.heldTotal>0;
  if (filter === "폐기 발생") return progress.scrapTotal>0;
  if (progress.needsOpening) return false;
  if (filter === "대기") return !progress.started;
  if (filter === "출고 완료") return progress.complete;
  const index = progress.steps.findIndex(step => step.name === filter);
  return index >= 0 && progress.available[index] > 0;
}
export function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}
