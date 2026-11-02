import test from "node:test";
import assert from "node:assert/strict";
import { getProgress, matchesStage, steps, validateOpening, validateQuantity } from "../lib/workflow.js";
import { isOverdue } from "../lib/order-utils.js";

const order = counts => ({
  target_qty: 100, quantity_confirmed: true, current_step: "부분출고",
  process_quantities: Object.fromEntries(steps.map((s, i) => [s.name, counts[i]])),
});

test("different quantities can remain at several processes within one order", () => {
  const wo = order([67, 53, 39, 31, 21, 13]);
  const p = getProgress(wo);
  assert.deepEqual(p.available, [33, 14, 14, 8, 10, 8]);
  assert.equal(p.shipped, 13);
  assert.equal(p.remaining, 87);
  assert.equal(p.complete, false);
  for (const s of steps) assert.equal(matchesStage(wo, s.name), true);
  assert.equal(matchesStage(wo, "출고 완료"), false);
});

test("only full shipment finishes an order and removes overdue status", () => {
  const partial = { ...order([100, 100, 100, 100, 100, 99]), due_date: "2026-10-01" };
  assert.equal(isOverdue(partial, new Date(2026, 10, 2)), true);
  const done = { ...partial, ...order([100, 100, 100, 100, 100, 100]) };
  assert.equal(getProgress(done).complete, true);
  assert.equal(isOverdue(done, new Date(2026, 10, 2)), false);
  assert.equal(matchesStage(done, "출고 완료"), true);
  assert.equal(matchesStage(done, "출고"), false);
});

test("unknown historical quantities are never inferred from an old completion label", () => {
  const wo = { target_qty: 100, current_step: "출고완료", quantity_confirmed: false };
  const p = getProgress(wo);
  assert.equal(p.needsOpening, true);
  assert.equal(p.complete, false);
  assert.deepEqual(p.completed, [0, 0, 0, 0, 0, 0]);
  assert.equal(matchesStage(wo, "수량 확인"), true);
  assert.equal(matchesStage(wo, "조형"), false);
});

test("quantity input rejects blanks, fractions, negatives and excess quantities", () => {
  for (const qty of ["", " ", "0", "-1", "1.5", "Infinity", "abc", "2147483648", "14"])
    assert.notEqual(validateQuantity(qty, 13), "");
  assert.equal(validateQuantity("7", 13), "");
  assert.equal(validateQuantity("13", 13), "");
});

test("opening counts require six explicit, nonincreasing integer totals", () => {
  assert.equal(validateOpening([67, 53, 39, 31, 21, 13], 100), "");
  assert.equal(validateOpening([0, 0, 0, 0, 0, 0], 100), "");
  for (const totals of [[101, 0, 0, 0, 0, 0], [10, 11, 0, 0, 0, 0],
    [10, 9, 8, 7, 6], ["", 0, 0, 0, 0, 0], [1.5, 0, 0, 0, 0, 0]])
    assert.notEqual(validateOpening(totals, 100), "");
});
