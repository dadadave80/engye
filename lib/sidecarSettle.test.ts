import { describe, expect, test } from "bun:test";
import { computeSettlement, extractSettlementJob, type SettlementJob } from "./sidecarSettle";

const job = (events: SettlementJob["events"], extra: Partial<SettlementJob> = {}): SettlementJob => ({
  rate_usdc_per_second: 0.0001,
  events,
  ...extra,
});

describe("computeSettlement", () => {
  test("pairs joined/parted per viewer", () => {
    const s = computeSettlement(
      job([
        { viewer: "a", event: "joined", t: 0 },
        { viewer: "a", event: "parted", t: 340 },
        { viewer: "b", event: "joined", t: 60 },
        { viewer: "b", event: "parted", t: 180 },
      ]),
    );
    expect(s.per_viewer).toEqual({ a: 340, b: 120 });
    expect(s.total_seconds).toBe(460);
    expect(s.total_usdc).toBe(0.046);
  });

  test("unclosed join runs to end of log; orphan part ignored", () => {
    const s = computeSettlement(
      job([
        { viewer: "ghost", event: "parted", t: 10 },
        { viewer: "a", event: "joined", t: 100 },
        { viewer: "b", event: "joined", t: 0 },
        { viewer: "b", event: "parted", t: 200 },
      ]),
    );
    expect(s.per_viewer).toEqual({ a: 100, b: 200 }); // a: 100 → 200 (maxT)
    expect(s.per_viewer.ghost).toBeUndefined();
  });

  test("ISO timestamps + 6dp rounding", () => {
    const s = computeSettlement(
      job(
        [
          { viewer: "a", event: "joined", t: "2026-07-05T00:00:00Z" },
          { viewer: "a", event: "parted", t: "2026-07-05T00:05:40Z" },
        ],
        { rate_usdc_per_second: 0.000123 },
      ),
    );
    expect(s.total_seconds).toBe(340);
    expect(s.total_usdc).toBe(0.04182);
  });

  test("recipient shares normalize; default is a single creator", () => {
    const base = [
      { viewer: "a", event: "joined", t: 0 },
      { viewer: "a", event: "parted", t: 100 },
    ] as SettlementJob["events"];
    const withR = computeSettlement(job(base, { recipients: [{ name: "streamer", share: 9 }, { name: "platform", share: 1 }] }));
    expect(withR.recipients.map((r) => r.amount_usdc)).toEqual([0.009, 0.001]);
    expect(withR.recipients.map((r) => r.share)).toEqual([0.9, 0.1]);
    const noR = computeSettlement(job(base));
    expect(noR.recipients).toEqual([{ name: "creator", share: 1, amount_usdc: 0.01 }]);
  });

  test("double-join keeps the first join", () => {
    const s = computeSettlement(
      job([
        { viewer: "a", event: "joined", t: 0 },
        { viewer: "a", event: "joined", t: 50 },
        { viewer: "a", event: "parted", t: 100 },
      ]),
    );
    expect(s.per_viewer).toEqual({ a: 100 });
  });
});

describe("extractSettlementJob", () => {
  const raw = `{"rate_usdc_per_second":0.0001,"events":[{"viewer":"a","event":"joined","t":0},{"viewer":"a","event":"parted","t":10}]}`;
  test("fenced json", () => {
    expect(extractSettlementJob("Settle this: ```json\n" + raw + "\n``` thanks")).not.toBeNull();
  });
  test("raw json in prose", () => {
    expect(extractSettlementJob("Compute: " + raw + " and return JSON")).not.toBeNull();
  });
  test("absent → null (the registry probe path)", () => {
    expect(extractSettlementJob("Registry probe: what is 17 + 25? Reply with the number and one short sentence.")).toBeNull();
  });
});
