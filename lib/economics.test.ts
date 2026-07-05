/// <reference types="bun-types" />
import { test, expect } from "bun:test";
import {
  feeFor, bondFor, betaConfidence, calibratedConfidence, evGateAccepts,
  MIN_BOND, MAX_BOND, RISK_MARGIN,
} from "./economics";

test("feeFor floors at MIN_FEE and scales at FEE_BPS", () => {
  expect(feeFor(0.01)).toBeCloseTo(0.0005, 9); // 0.01*2% = 0.0002 → floored to MIN_FEE
  expect(feeFor(1)).toBeCloseTo(0.02, 9);       // 1*2% = 0.02
});

test("bondFor: confidence 0.5→1x, 0.75→3x, 0.99→5x multiplier", () => {
  expect(bondFor(0.01, 0.5)).toBeCloseTo(0.01, 9);
  expect(bondFor(0.01, 0.75)).toBeCloseTo(0.03, 9);
  expect(bondFor(0.01, 0.99)).toBeCloseTo(0.05, 9);
});

test("bondFor clamps to MIN_BOND floor and MAX_BOND cap", () => {
  expect(bondFor(0.0002, 0.5)).toBeCloseTo(MIN_BOND, 9); // 0.0002 < MIN_BOND
  expect(bondFor(1, 0.99)).toBeCloseTo(MAX_BOND, 9);     // 1*5 = 5 > MAX_BOND
});

test("betaConfidence smooths with a +2/+4 prior", () => {
  expect(betaConfidence(0, 0)).toBeCloseTo(0.5, 9);
  expect(betaConfidence(9, 10)).toBeCloseTo(11 / 14, 9);
});

test("calibratedConfidence blends 50/50 until 10 trials, then pure beta", () => {
  expect(calibratedConfidence(0.9, 9, 10)).toBeCloseTo(11 / 14, 9); // trials>=10 → beta
  expect(calibratedConfidence(0.9, 2, 2)).toBeCloseTo(0.5 * (4 / 6) + 0.5 * 0.9, 9);
});

test("evGateAccepts accepts at the boundary and rejects just below it", () => {
  // build the exact break-even fee so the test is robust to RISK_MARGIN's env value
  const bond = 0.001, cHat = 0.5;
  const breakEven = (1 - cHat) * bond * RISK_MARGIN;
  expect(evGateAccepts(breakEven, bond, cHat)).toBe(true);
  expect(evGateAccepts(breakEven - 1e-9, bond, cHat)).toBe(false);
});