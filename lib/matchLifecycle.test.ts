// The rulebook, held to its own rules: table shape, reachability, guard derivation, and the
// outcome() truth table. If a status or edge is ever added/removed, these fail before any reader
// or guarded write can drift.
import { describe, expect, test } from "bun:test";
import {
  CLAIMABLE,
  IN_VERDICT_WINDOW,
  MATCH_STATUSES,
  TERMINAL,
  TRANSITIONS,
  canTransition,
  isAtRisk,
  isSettled,
  isTerminal,
  legalFroms,
  outcome,
  type MatchStatus,
} from "./matchLifecycle";

describe("transition table", () => {
  test("terminal statuses have no exits", () => {
    for (const t of TERMINAL) expect(TRANSITIONS[t]).toEqual([]);
  });

  test("every status is reachable from pending", () => {
    const seen = new Set<MatchStatus>(["pending"]);
    const queue: MatchStatus[] = ["pending"];
    while (queue.length) {
      for (const next of TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    expect([...seen].sort()).toEqual([...MATCH_STATUSES].sort());
  });

  test("every edge points at a real status", () => {
    for (const froms of Object.values(TRANSITIONS))
      for (const to of froms) expect(MATCH_STATUSES).toContain(to);
  });

  test("the double-settle jump is illegal: nothing leaves a terminal status", () => {
    for (const t of TERMINAL)
      for (const to of MATCH_STATUSES) expect(canTransition(t, to)).toBe(false);
  });

  test("legalFroms derives the guards the store enforces", () => {
    expect(legalFroms("bonded")).toEqual(["pending"]);
    expect(legalFroms("paid")).toEqual(["pending", "bonded"]); // unbonded path skips 'bonded'
    expect(legalFroms("awaiting_verdict")).toEqual(["paid"]);
    expect(legalFroms("delivered")).toEqual(["validating", "settle_retry"]); // lease holder — or a settler a racer demoted
    expect(legalFroms("failed_compensated")).toEqual(["validating", "settle_retry"]);
    expect(legalFroms("settle_retry")).toEqual(["validating"]);
    expect(legalFroms("error")).toEqual(["pending", "bonded", "paid", "awaiting_verdict"]);
  });

  test("the sweep's claimable set is exactly the non-lease entries into 'validating'", () => {
    expect([...CLAIMABLE, "validating"].sort()).toEqual([...legalFroms("validating")].sort());
  });

  test("the verdict window never contains a terminal status", () => {
    for (const s of IN_VERDICT_WINDOW) expect(isTerminal(s)).toBe(false);
  });
});

describe("predicates + outcome()", () => {
  test("isTerminal/isSettled/isAtRisk mirror dashboard semantics", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isSettled("failed_compensated")).toBe(true);
    expect(isTerminal("awaiting_verdict")).toBe(false);
    expect(isAtRisk("bonded")).toBe(true);
    expect(isAtRisk("paid")).toBe(true);
    expect(isAtRisk("awaiting_verdict")).toBe(false); // existing dashboard behavior, kept exactly
  });

  test("outcome() is the one disambiguator of the overloaded 'delivered'", () => {
    expect(outcome({ status: "delivered", bond_tx: "0xbond" })).toBe("passed");
    expect(outcome({ status: "delivered", bond_tx: null })).toBe("best_effort");
    expect(outcome({ status: "delivered" })).toBe("best_effort");
    expect(outcome({ status: "failed_compensated", bond_tx: "0xbond" })).toBe("slashed");
    expect(outcome({ status: "error" })).toBe("errored");
    for (const s of ["pending", "bonded", "paid", "awaiting_verdict", "validating", "settle_retry"])
      expect(outcome({ status: s })).toBe("in_flight");
    expect(outcome({})).toBe("in_flight"); // missing status on a loose row → safest answer
  });
});
