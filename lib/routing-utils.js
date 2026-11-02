export const processRoles = { production: "일반 공정", inspection: "검사", shipment: "출고 (마지막 공정)" };
export function validateRouting(route) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(route.routing_code || "")) return "라우팅 코드는 영문·숫자·밑줄·하이픈 40자 이내로 입력하세요.";
  if (!route.routing_name?.trim() || route.routing_name.trim().length > 100) return "라우팅명은 1~100자로 입력하세요.";
  if ((route.description || "").length > 1000) return "설명은 1,000자 이내로 입력하세요.";
  if (!Array.isArray(route.steps) || route.steps.length < 1 || route.steps.length > 30) return "공정은 1~30개로 구성하세요.";
  const names = new Set(), keys = new Set();
  for (const [i, step] of route.steps.entries()) {
    const name = step.name?.trim();
    if (!name || name.length > 60 || (step.place || "").length > 100) return "공정명은 1~60자, 작업장은 100자 이내로 입력하세요.";
    if (names.has(name) || keys.has(step.key)) return "같은 공정을 중복 등록할 수 없습니다.";
    names.add(name); keys.add(step.key);
    if (!step.key || !processRoles[step.role]) return "공정 구분을 확인하세요.";
    if ((step.role === "shipment") !== (i === route.steps.length - 1)) return "출고 공정은 마지막에 한 번만 배치하세요.";
  }
  return "";
}
