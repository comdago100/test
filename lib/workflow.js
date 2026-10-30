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
export function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}