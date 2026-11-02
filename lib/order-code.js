import { validateOrderId } from "./order-utils.js";

export const PRODUCTION_ORIGIN = "https://test-ict.pages.dev";

export function buildOrderUrl(orderId) {
  const id = String(orderId ?? "").trim();
  const error = validateOrderId(id);
  if (error) throw new Error(error);
  const url = new URL("/scanner/", PRODUCTION_ORIGIN);
  url.searchParams.set("wo_id", id);
  return url.href;
}

export function parseOrderCode(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  let id = value;
  if (value.includes("://") || /^https?:/i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error("작업지시 QR 주소를 확인해 주세요."); }
    const host = url.hostname;
    const knownHost = host === "test-ict.pages.dev" || host.endsWith(".test-ict.pages.dev")
      || ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (!["https:", "http:"].includes(url.protocol) || !knownHost || url.username || url.password
      || url.pathname.replace(/\/$/, "") !== "/scanner" || url.searchParams.getAll("wo_id").length !== 1) {
      throw new Error("지원하는 작업지시 QR 주소가 아닙니다.");
    }
    id = (url.searchParams.get("wo_id") || "").trim();
  }
  const error = validateOrderId(id);
  if (error) throw new Error(error);
  return id;
}
