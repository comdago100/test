export function validateOrderId(value) {
  const id = value.trim();
  if (!id) return "작업지시 번호를 입력하세요.";
  if (id.length > 80 || /\s/.test(id)) return "작업지시 번호는 공백 없이 80자 이내로 입력하세요.";
  return "";
}
export function isOverdue(order, today = new Date()) {
  if (!order.due_date || order.current_step === "출고완료") return false;
  const date = [today.getFullYear(), String(today.getMonth()+1).padStart(2,"0"), String(today.getDate()).padStart(2,"0")].join("-");
  return order.due_date < date;
}