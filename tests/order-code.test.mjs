import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderUrl, parseOrderCode } from "../lib/order-code.js";

test("printed QR payload is a public URL that opens the exact order", () => {
  assert.equal(buildOrderUrl("test"), "https://test-ict.pages.dev/scanner/?wo_id=test");
  for (const id of ["WO-261102-001", "지시-001", "WO+A&B#1", "WO/001?A"]) {
    const url = buildOrderUrl(id);
    assert.equal(new URL(url).searchParams.get("wo_id"), id);
    assert.equal(parseOrderCode(url), id);
  }
});

test("old number-only QR codes and keyboard input still work", () => {
  assert.equal(parseOrderCode("  test  "), "test");
  assert.equal(parseOrderCode("WO-001"), "WO-001");
  assert.equal(parseOrderCode(""), "");
});

test("scanner accepts supported preview and local URLs", () => {
  for (const base of ["https://f1390ab6.test-ict.pages.dev", "http://localhost:3100", "http://127.0.0.1:3100"]) {
    assert.equal(parseOrderCode(base + "/scanner/?wo_id=test"), "test");
  }
});

test("invalid QR URLs never turn into a different work order", () => {
  for (const value of ["https://example.com/scanner/?wo_id=test",
    "https://test-ict.pages.dev.evil.example/scanner/?wo_id=test",
    "https://test-ict.pages.dev/orders/?wo_id=test", "https://test-ict.pages.dev/scanner/",
    "https://test-ict.pages.dev/scanner/?wo_id=", "https://test-ict.pages.dev/scanner/?wo_id=A&wo_id=B",
    "https://user:pass@test-ict.pages.dev/scanner/?wo_id=test", "ftp://test-ict.pages.dev/scanner/?wo_id=test",
    "https://test-ict.pages.dev/scanner/?wo_id=with+space", "A".repeat(81)])
    assert.throws(() => parseOrderCode(value));
  assert.throws(() => buildOrderUrl("bad id"));
});
