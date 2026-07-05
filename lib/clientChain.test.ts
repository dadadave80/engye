import { test, expect } from "bun:test";
import { usdcAtomicOrNull } from "./clientChain";

test("parses valid positive amounts to atomic units", () => {
  expect(usdcAtomicOrNull(1)).toBe(1_000_000n);
  expect(usdcAtomicOrNull(0.25)).toBe(250_000n);
});

test("rejects NaN, non-finite, zero, and negative", () => {
  expect(usdcAtomicOrNull(Number("abc"))).toBeNull(); // Number("abc") === NaN
  expect(usdcAtomicOrNull(Number("1,5"))).toBeNull();
  expect(usdcAtomicOrNull(0)).toBeNull();
  expect(usdcAtomicOrNull(-1)).toBeNull();
});
