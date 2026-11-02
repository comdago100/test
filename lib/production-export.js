import { getProgress, steps } from "./workflow.js";

const KST_OFFSET = 9 * 60 * 60 * 1000;
const col = (title, kind = "text", width = 18) => ({ title, kind, width });
const number = value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const sheet = (name, columns, rows) => ({ name, columns, rows });
const namesBy = (rows, code, name) => Object.fromEntries(rows.map(row => [row[code], row[name]]));

// Excel date cells have no timezone. Shift UTC timestamps to display Korea's local clock.
export function excelKstDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Date(date.valueOf() + KST_OFFSET);
}
function calendarDate(value) {
  if (!value) return null;
  const date = new Date(String(value).slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(date.valueOf()) ? null : date;
}
export function kstStamp(value = new Date()) {
  return excelKstDate(value)?.toISOString().replace("T", " ").slice(0, 19) || "";
}
export function exportFilename(prefix, value = new Date()) {
  return prefix + "_" + kstStamp(value).replace(/[-:]/g, "").replace(" ", "_") + ".xlsx";
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function historyBounds(start = "", end = "") {
  if (start && !validDay(start) || end && !validDay(end) || start && end && start > end)
    throw new Error("실적 기간의 시작일과 종료일을 확인하세요.");
  return {
    from: start ? new Date(start + "T00:00:00+09:00").toISOString() : null,
    until: end ? new Date(new Date(end + "T00:00:00+09:00").valueOf() + 86400000).toISOString() : null,
  };
}

export function buildProductionSheets(data, options = {}) {
  const { orders = [], clients = [], items = [], materials = [], usage = [], events = [] } = data;
  const generatedAt = options.generatedAt || new Date();
  const asOf = new Date(generatedAt).valueOf();
  if (!Number.isFinite(asOf)) throw new Error("자료 기준 시각을 확인하세요.");
  const bounds = historyBounds(options.start, options.end);
  const clientNames = namesBy(clients, "client_code", "client_name");
  const itemNames = namesBy(items, "item_code", "item_name");
  const materialNames = namesBy(materials, "raw_code", "raw_name");
  const orderMap = new Map(orders.map(order => [order.wo_id, order]));
  const identity = order => [order.wo_id, order.client_code || "", clientNames[order.client_code] || "",
    order.item_code || "", itemNames[order.item_code] || ""];
  const identityColumns = [col("작업지시 번호", "text", 26), col("거래처 코드"), col("거래처명", "text", 24), col("품목 코드"), col("품목명", "text", 24)];
  const today = kstStamp(generatedAt).slice(0, 10);
  const inRange = event => {
    const time = new Date(event.created_at).valueOf();
    return orderMap.has(event.wo_id) && Number.isFinite(time) && time <= asOf
      && (!bounds.from || time >= new Date(bounds.from).valueOf())
      && (!bounds.until || time < new Date(bounds.until).valueOf());
  };
  const selectedEvents = events.filter(inRange).sort((a, b) => new Date(a.created_at).valueOf() - new Date(b.created_at).valueOf() || String(a.event_id).localeCompare(String(b.event_id)));
  const eventColumns = [col("처리 일시(KST)", "datetime", 23), ...identityColumns, col("공정"),
    col("기록 구분"), col("처리 수량(개)", "number"), col("기록 ID", "text", 38),
    col("취소 원본 ID", "text", 38), col("메모", "text", 40)];
  const eventRows = selectedEvents.map(event => [
    excelKstDate(event.created_at), ...identity(orderMap.get(event.wo_id)), steps[event.step]?.name || "",
    { completion: "완료", reversal: "취소", opening: "기초수량 확인" }[event.kind] || event.kind || "",
    number(event.quantity), String(event.event_id ?? ""), event.reversal_of || "", event.note || "",
  ]);
  const orderRows = orders.map(order => {
    const p = getProgress(order), known = p.tracked;
    return [...identity(order), number(order.target_qty), order.current_step || "발행대기",
      known ? "확인 완료" : "수량 확인 필요",
      ...p.completed.map(qty => known ? qty : null), known ? p.remaining : null,
      !known ? "수량 확인 필요" : order.due_date && order.due_date < today && !p.complete ? "납기 지연" : "",
      excelKstDate(order.created_at), calendarDate(order.start_date), calendarDate(order.due_date),
      number(order.unit_weight_kg), order.heat_no || "", order.casting_material || "", order.notes || ""];
  });
  const processRows = orders.flatMap(order => {
    const p = getProgress(order);
    return steps.map((step, i) => [...identity(order), step.name, number(order.target_qty),
      p.tracked ? p.completed[i] : null, p.tracked ? p.available[i] : null,
      p.tracked ? "확인 완료" : "수량 확인 필요"]);
  });
  const materialRows = usage.filter(row => orderMap.has(row.wo_id)).map(row => [
    ...identity(orderMap.get(row.wo_id)), String(row.usage_id ?? ""), row.raw_code || "",
    materialNames[row.raw_code] || "", number(row.input_qty), "kg",
  ]);
  return [
    sheet("조회조건", [col("항목", "text", 28), col("내용", "text", 90)], [
      ["현황 조회 시각(KST)", kstStamp(options.snapshotAt || generatedAt)],
      ["파일 생성·이력 조회 기준(KST)", kstStamp(generatedAt)],
      ["대상 범위", options.scopeLabel || "선택한 작업지시"], ["작업지시 건수", String(orders.length)],
      ["검색어", options.query || ""], ["공정 필터", options.filter || "전체"],
      ["실적 기간 시작(KST)", options.start || "전체 기간"], ["실적 기간 종료(KST)", options.end || "전체 기간"],
      ["현황·원재료 기준", "작업지시 현황과 원재료 투입은 선택한 작업의 전체 누적 자료입니다. 기간은 공정·출고 이력에만 적용합니다."],
      ["공정 수량", "각 공정의 누적 완료와 지금 처리할 수 있는 수량입니다. 수량 확인이 필요한 작업은 빈칸으로 표시합니다."],
      ["취소 기록", "취소 수량은 음수입니다. 완료·취소를 합산하면 해당 기간의 순처리 수량이 됩니다."],
      ["출고 이력", "출고의 완료·취소 기록만 포함합니다. 과거 누적 수량을 등록한 기초수량은 실제 출고일을 알 수 없어 제외합니다."],
      ["원재료 투입", "제품 개수와 구분해 kg으로 제공합니다. 투입일자는 현재 기록에서 확인할 수 없어 제공하지 않습니다."],
    ]),
    sheet("작업지시 현황", [...identityColumns, col("목표 수량(개)", "number"), col("현재 상태"), col("수량 확인"),
      ...steps.map(step => col(step.name + " 누적 완료(개)", "number", 22)), col("출고 잔량(개)", "number"),
      col("납기 상태"), col("발행 일시(KST)", "datetime", 23), col("작업 시작일", "date"), col("납기일", "date"),
      col("제품 단중(kg)", "decimal"), col("용해 번호"), col("재질"), col("작업 메모", "text", 40)], orderRows),
    sheet("공정별 수량", [...identityColumns, col("공정"), col("목표 수량(개)", "number"),
      col("누적 완료(개)", "number"), col("현재 처리 가능(개)", "number", 24), col("수량 확인")], processRows),
    sheet("공정 처리 이력", eventColumns, eventRows),
    sheet("출고 이력", eventColumns, eventRows.filter((row, i) => selectedEvents[i].step === steps.length - 1 && selectedEvents[i].kind !== "opening")),
    sheet("원재료 투입", [...identityColumns, col("투입 기록 ID", "text", 22), col("원재료 코드"),
      col("원재료명", "text", 24), col("투입 중량(kg)", "decimal", 22), col("단위")], materialRows),
  ];
}

export function buildMasterSheets(kind, rows) {
  const configs = {
    client: { name: "거래처 목록", columns: [col("거래처 코드"), col("거래처명", "text", 28), col("연락처", "text", 30)],
      row: row => [row.client_code, row.client_name, row.contact_info || ""] },
    item: { name: "품목 목록", columns: [col("품목 코드"), col("품목명", "text", 28), col("제품 단중(kg)", "decimal", 22)],
      row: row => [row.item_code, row.item_name, number(row.unit_weight)] },
    material: { name: "원재료 목록", columns: [col("원재료 코드"), col("원재료명", "text", 28), col("단위")],
      row: row => [row.raw_code, row.raw_name, row.unit || "kg"] },
  };
  const config = configs[kind];
  if (!config) throw new Error("지원하지 않는 자료입니다.");
  return [sheet(config.name, config.columns, rows.map(config.row))];
}
