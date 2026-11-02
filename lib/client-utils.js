export const clientTypes = { customer: "매출처", supplier: "매입처", both: "매출·매입처", outsourcer: "외주처" };
export const clientGroups = [
  { title: "연락처·담당자", fields: [
    ["contact_name","담당자명",100],["contact_phone","담당자 연락처",50,"tel"],
    ["phone","대표 전화",50,"tel"],["fax","팩스",50,"tel"],
    ["email","이메일",254,"email"],["tax_email","계산서 수신 이메일",254,"email"],
  ] },
  { title: "사업자 정보", optional: true, fields: [
    ["business_number","사업자등록번호",20,"text","예: 123-45-67890"],
    ["representative","대표자명",100],["business_type","업태",100],["business_item","종목",200],
  ] },
  { title: "주소·납품", fields: [
    ["postal_code","우편번호",5,"text","국내 우편번호 5자리"],
    ["address","사업장 주소",500],["shipping_address","납품 주소",500],
    ["delivery_notes","납품 안내",1000,"textarea","입고 시간, 차량 출입, 포장·하차 시 주의사항 등"],
  ] },
  { title: "거래 조건·메모", fields: [
    ["payment_terms","결제 조건",200,"text","예: 월말 마감, 익월 말 지급"],
    ["notes","거래처 메모",2000,"textarea","품질 기준, 연락 시 주의사항 등"],
  ] },
];
export const clientFields = clientGroups.flatMap(group => group.fields);
export function emptyClient() {
  return { client_code:"", client_name:"", client_type:"customer", is_active:true,
    ...Object.fromEntries(clientFields.map(([key]) => [key,""])) };
}
export function clientForm(row) {
  const blank=emptyClient();
  return Object.fromEntries(Object.entries(blank).map(([key,value])=>[key,row[key] ?? value]));
}
export function formatBusinessNumber(value) {
  const text=String(value || "").replace(/[\s-]/g,"");
  return /^\d{10}$/.test(text) ? text.slice(0,3)+"-"+text.slice(3,5)+"-"+text.slice(5) : text;
}
export function validateClient(form, creating = true) {
  if (!form.client_code?.trim() || !form.client_name?.trim()) return "거래처 코드와 거래처명을 입력하세요.";
  if (form.client_code.length>80 || creating && /\s/.test(form.client_code.trim())) return "거래처 코드는 공백 없이 80자 이내로 입력하세요.";
  if (form.client_name.trim().length>200) return "거래처명은 200자 이내로 입력하세요.";
  if (!clientTypes[form.client_type] || typeof form.is_active!=="boolean") return "거래처 구분과 사용 상태를 확인하세요.";
  for (const [key,label,max] of clientFields) {
    if (String(form[key] || "").trim().length>max) return `${label}은 ${max}자 이내로 입력하세요.`;
  }
  const business=String(form.business_number || "").replace(/[\s-]/g,"");
  if (business && !/^\d{10}$/.test(business)) return "사업자등록번호는 숫자 10자리로 입력하세요.";
  if (form.postal_code && !/^\d{5}$/.test(form.postal_code.trim())) return "국내 우편번호는 숫자 5자리로 입력하세요.";
  for (const key of ["email","tax_email"]) {
    if (form[key]?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form[key].trim())) return "이메일 주소 형식을 확인하세요.";
  }
  return "";
}
export function clientPayload(form) {
  return { ...Object.fromEntries(Object.entries(form).map(([key,value])=>[key,typeof value==="string" ? value.trim():value])),
    business_number:String(form.business_number || "").replace(/[\s-]/g,"") };
}
export function clientMatches(row, query, type="all", status="all") {
  if (type!=="all" && (row.client_type || "customer")!==type) return false;
  if (status==="active" && row.is_active===false || status==="inactive" && row.is_active!==false) return false;
  const needle=query.trim().toLowerCase();
  const text=[row.client_code,row.client_name,clientTypes[row.client_type || "customer"],row.contact_info,
    ...clientFields.map(([key])=>row[key]),formatBusinessNumber(row.business_number)].join(" ").toLowerCase();
  return text.includes(needle) || Boolean(needle) && text.replace(/[\s-]/g,"").includes(needle.replace(/[\s-]/g,""));
}
