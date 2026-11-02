import { test, expect } from "@playwright/test";
import jsQR from "jsqr";

const names = ["조형", "주입", "가공", "검사", "포장", "출고"];
function order(quantities = [0, 0, 0, 0, 0, 0]) {
  return { wo_id: "WO-PARTIAL", client_code: "C", item_code: "I", target_qty: 100,
    quantity_confirmed: true, current_step: "발행대기",
    process_quantities: Object.fromEntries(names.map((name, i) => [name, quantities[i]])) };
}
async function backend(page, initial = order()) {
  const state = { order: initial, events: [], calls: [], lookups: [], requests: new Set(), loseResponse: false, rejectNext: false };
  await page.route("**/rest/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS" };
    const fulfill = json => route.fulfill({ status: 200, headers, json });
    if (request.method() === "OPTIONS") return fulfill(null);
    if (request.method() === "GET") {
      if (path.endsWith("/work_orders")) {
        const filter = new URL(request.url()).searchParams.get("wo_id");
        if (filter) state.lookups.push(filter);
        return fulfill(filter ? state.order : [state.order]);
      }
      if (path.endsWith("/production_events")) return fulfill([...state.events].reverse());
      return fulfill([]);
    }
    const rpc = path.split("/").pop(), args = request.postDataJSON();
    state.calls.push({ rpc, args });
    if (state.rejectNext) {
      state.rejectNext = false;
      return route.fulfill({ status: 400, headers,
        json: { code: "P0001", message: "앞 공정 완료 수량을 초과합니다" } });
    }
    if (!state.requests.has(args.p_request_id)) {
      state.requests.add(args.p_request_id);
      if (rpc === "initialize_production_quantities") {
        state.order.quantity_confirmed = true;
        state.order.process_quantities = args.p_quantities;
      } else {
        const source = rpc === "reverse_production_progress" ? state.events.find(event => event.event_id === args.p_event_id) : null;
        const step = source ? source.step : args.p_step, quantity = source ? -source.quantity : args.p_quantity;
        state.order.process_quantities[names[step]] += quantity;
        state.events.push({ event_id: args.p_request_id, step, quantity,
          kind: source ? "reversal" : "completion", reversal_of: source?.event_id || null,
          note: args.p_note || "", created_at: new Date().toISOString() });
      }
      const shipped = state.order.process_quantities["출고"];
      state.order.current_step = shipped === 100 ? "출고완료" : shipped > 0 ? "부분출고" : "생산진행";
    }
    if (state.loseResponse) { state.loseResponse = false; return route.abort("failed"); }
    return fulfill(state.order);
  });
  return state;
}
async function lookup(page) {
  await page.goto("/scanner/");
  await page.getByLabel("작업지시 번호", { exact: true }).fill("WO-PARTIAL");
  await page.getByRole("button", { name: "작업 조회", exact: true }).click();
  await expect(page.getByRole("heading", { name: "WO-PARTIAL", exact: true })).toBeVisible();
}
function station(page, name) { return page.locator(".station").filter({ has: page.getByText(name, { exact: true }) }); }

test("scanning only looks up the order; each submission adds the entered quantity", async ({ page }) => {
  const state = await backend(page);
  await lookup(page);
  expect(state.calls).toHaveLength(0);
  const quantity = page.getByLabel("이번 처리 수량 (개)", { exact: true });
  await expect(quantity).toHaveValue("");
  await quantity.fill("13");
  await page.getByRole("button", { name: "조형 수량 기록", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toContainText("조형 13개");
  await expect(quantity).toHaveValue("");
  await station(page, "주입").click();
  await expect(page.locator(".available-quantity")).toContainText("13개");
  await quantity.fill("7");
  await page.getByRole("button", { name: "주입 수량 기록", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toContainText("주입 7개");
  expect(state.calls.map(call => call.args.p_quantity)).toEqual([13, 7]);
  await station(page, "출고").click();
  await expect(page.getByRole("button", { name: "출고 수량 기록", exact: true })).toBeDisabled();
});

test("partial shipment leaves the remainder and rejects an amount beyond packing", async ({ page }, testInfo) => {
  const state = await backend(page, order([67, 53, 39, 31, 21, 13]));
  await lookup(page); await station(page, "출고").click();
  const quantity = page.getByLabel("이번 처리 수량 (개)", { exact: true });
  await expect(quantity).toHaveAttribute("max", "8");
  await quantity.fill("9");
  await page.getByRole("button", { name: "출고 수량 기록", exact: true }).click();
  expect(state.calls).toHaveLength(0);
  await quantity.fill("3");
  await page.getByRole("button", { name: "출고 수량 기록", exact: true }).click();
  await expect(page.locator(".shipment-summary")).toContainText("누적 출고 16개");
  await expect(page.locator(".shipment-summary")).toContainText("출고 잔량 84개");
  await expect(page.locator(".scan-result.success")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("partial-shipment.png"), fullPage: true });
});

test("uncertain commits retain the same request ID across reload and retry", async ({ page }) => {
  const state = await backend(page);
  await lookup(page);
  state.loseResponse = true;
  await page.getByLabel("이번 처리 수량 (개)", { exact: true }).fill("13");
  await page.getByRole("button", { name: "조형 수량 기록", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 기록 확인 / 재시도", exact: true })).toBeVisible();
  const request = state.calls[0].args.p_request_id;
  await page.evaluate(() => history.replaceState(null, "", "/scanner/?wo_id=WO-PARTIAL"));
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "같은 기록 확인 / 재시도", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toContainText("조형 13개");
  expect(state.calls.at(-1).args.p_request_id).toBe(request);
  expect(state.lookups).toHaveLength(1);
  expect(state.order.process_quantities["조형"]).toBe(13);
  await expect(page.getByRole("button", { name: "같은 기록 확인 / 재시도", exact: true })).toHaveCount(0);
});

test("a server rejection refreshes quantities changed by another scanner", async ({ page }) => {
  const state = await backend(page);
  await lookup(page);
  state.order.process_quantities["조형"] = 97;
  state.rejectNext = true;
  const quantity = page.getByLabel("이번 처리 수량 (개)", { exact: true });
  await quantity.fill("13");
  await page.getByRole("button", { name: "조형 수량 기록", exact: true }).click();
  await expect(page.locator(".scan-result.failure")).toContainText("초과");
  await expect(page.locator(".available-quantity")).toContainText("3개");
  await expect(quantity).toHaveAttribute("max", "3");
  await quantity.fill("2");
  await page.getByRole("button", { name: "조형 수량 기록", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toContainText("조형 2개");
  expect(state.order.process_quantities["조형"]).toBe(99);
});

test("legacy records require six explicit opening totals", async ({ page }) => {
  const state = await backend(page, { ...order(), quantity_confirmed: false, current_step: "출고완료" });
  await lookup(page);
  await expect(page.getByLabel("이번 처리 수량 (개)", { exact: true })).toHaveCount(0);
  const totals = [67, 53, 39, 31, 21, 13];
  for (const [i, name] of names.entries()) {
    const field = page.getByLabel(name + " 누적 완료 (개)", { exact: true });
    await expect(field).toHaveValue(""); await field.fill(String(totals[i]));
  }
  await page.getByRole("button", { name: "기존 수량 확인 및 시작", exact: true }).click();
  await expect(page.locator(".shipment-summary")).toContainText("출고 잔량 87개");
  expect(state.calls[0].rpc).toBe("initialize_production_quantities");
  expect(Object.values(state.calls[0].args.p_quantities)).toEqual(totals);
});

test("an input cancellation is shown as history and restores the available balance", async ({ page }) => {
  const state = await backend(page);
  await lookup(page);
  await page.getByLabel("이번 처리 수량 (개)", { exact: true }).fill("13");
  await page.getByRole("button", { name: "조형 수량 기록", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "기록 취소", exact: true }).click();
  await expect(page.locator(".scan-result.success")).toContainText("취소했습니다");
  await expect(page.locator(".available-quantity")).toContainText("100개");
  await expect(page.getByRole("button", { name: "기록 취소", exact: true })).toHaveCount(0);
  expect(state.events.map(event => event.quantity)).toEqual([13, -13]);
});

test("the printed QR decodes to a phone link that automatically opens its order", async ({ page }) => {
  const state = await backend(page, { ...order(), wo_id: "test" });
  await page.goto("/orders/");
  await page.getByRole("button", { name: "지시서 / QR 인쇄", exact: true }).click();
  const qr = page.getByRole("img", { name: "test 스캔용 QR 코드", exact: true });
  await expect(qr).toBeVisible();
  const pixels = await qr.evaluate(async img => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(image.data), width: image.width, height: image.height };
  });
  const decoded = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
  expect(decoded?.data).toBe("https://test-ict.pages.dev/scanner/?wo_id=test");
  await expect(page.getByRole("link", { name: "현장 화면 열기", exact: true })).toHaveAttribute("href", decoded.data);
  const url = new URL(decoded.data);
  await page.goto(url.pathname + url.search);
  await expect(page.getByRole("heading", { name: "test", exact: true })).toBeVisible();
  expect(state.lookups).toEqual(["eq.test"]);
  expect(state.calls).toHaveLength(0);
  await expect(page.getByLabel("이번 처리 수량 (개)", { exact: true })).toHaveValue("");
});

test("URL QR input is extracted for USB readers while ordinary number input still works", async ({ page }) => {
  const state = await backend(page);
  await page.goto("/scanner/");
  await page.getByLabel("작업지시 번호", { exact: true }).fill("https://test-ict.pages.dev/scanner/?wo_id=WO-PARTIAL");
  await page.getByRole("button", { name: "작업 조회", exact: true }).click();
  await expect(page.getByRole("heading", { name: "WO-PARTIAL", exact: true })).toBeVisible();
  expect(state.lookups).toEqual(["eq.WO-PARTIAL"]);
  expect(state.calls).toHaveLength(0);
});

test("foreign URL codes show an error without querying or saving an order", async ({ page }) => {
  const state = await backend(page);
  await lookup(page);
  await page.getByLabel("작업지시 번호", { exact: true }).fill("https://example.com/scanner/?wo_id=test");
  await page.getByRole("button", { name: "작업 조회", exact: true }).click();
  await expect(page.locator(".scan-result.failure")).toContainText("작업지시 QR 주소");
  await expect(page.getByRole("heading", { name: "WO-PARTIAL", exact: true })).toHaveCount(0);
  expect(state.lookups).toHaveLength(1);
  expect(state.calls).toHaveLength(0);
});
