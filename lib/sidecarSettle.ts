// Deterministic creator-settlement math for the sidecar provider — the count ENGYE bonds.
// Per-second presence settlement (Owncast-style joined/parted events), per the Canteen
// "Distribution Bootstrap" pattern. Pure functions, no LLM: anyone can recompute the statement
// from the event log, so the blind validator is checking arithmetic, not vibes.
// Spec: docs/superpowers/specs/2026-07-05-creator-settlement-sidecar-design.md
import { z } from "zod";

const eventSchema = z.object({
  viewer: z.string().min(1),
  event: z.enum(["joined", "parted"]),
  t: z.union([z.number(), z.string()]), // seconds or ISO-8601
});
const jobSchema = z.object({
  rate_usdc_per_second: z.number().positive(),
  events: z.array(eventSchema).min(1),
  recipients: z
    .array(z.object({ name: z.string().min(1), wallet: z.string().optional(), share: z.number().positive() }))
    .optional(),
});
export type SettlementJob = z.infer<typeof jobSchema>;

const toSeconds = (t: number | string): number => (typeof t === "number" ? t : Date.parse(t) / 1000);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Every balanced {…} substring, left to right (prose braces like "{a, b}" just fail to parse). */
function balancedBraceSpans(s: string): string[] {
  const spans: string[] = [];
  for (let i = s.indexOf("{"); i >= 0; i = s.indexOf("{", i + 1)) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) {
        spans.push(s.slice(i, j + 1));
        i = j; // skip past this span; outer loop continues after it
        break;
      }
    }
  }
  return spans;
}

/** Find + validate a settlement job inside a task spec (fenced ```json first, then any balanced {…}). */
export function extractSettlementJob(spec: string): SettlementJob | null {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  for (let m = fence.exec(spec); m; m = fence.exec(spec)) candidates.push(m[1]);
  candidates.push(...balancedBraceSpans(spec));
  for (const c of candidates) {
    try {
      const parsed = jobSchema.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data;
    } catch {
      /* not JSON — try next candidate */
    }
  }
  return null;
}

export function computeSettlement(job: SettlementJob) {
  const events = job.events
    .map((e) => ({ ...e, s: toSeconds(e.t) }))
    .filter((e) => Number.isFinite(e.s))
    .sort((a, b) => a.s - b.s);
  const maxT = events.length ? events[events.length - 1].s : 0;
  const open: Record<string, number> = {};
  const watched: Record<string, number> = {};
  for (const e of events) {
    if (e.event === "joined") {
      if (open[e.viewer] === undefined) open[e.viewer] = e.s; // double-join: keep the first
    } else if (open[e.viewer] !== undefined) {
      watched[e.viewer] = (watched[e.viewer] ?? 0) + Math.max(0, e.s - open[e.viewer]);
      delete open[e.viewer];
    } // orphan parted: ignored
  }
  for (const [viewer, since] of Object.entries(open)) {
    watched[viewer] = (watched[viewer] ?? 0) + Math.max(0, maxT - since); // unclosed join runs to end of log
  }
  const total_seconds = round6(Object.values(watched).reduce((a, b) => a + b, 0));
  const total_usdc = round6(total_seconds * job.rate_usdc_per_second);
  const recips = job.recipients?.length ? job.recipients : [{ name: "creator", share: 1 } as const];
  const shareSum = recips.reduce((a, r) => a + r.share, 0);
  const recipients = recips.map((r) => ({
    name: r.name,
    ...("wallet" in r && r.wallet ? { wallet: r.wallet } : {}),
    share: round6(r.share / shareSum),
    amount_usdc: round6((total_usdc * r.share) / shareSum),
  }));
  return {
    method: "per-second presence: paired joined/parted events; unclosed joins run to end of log",
    rate_usdc_per_second: job.rate_usdc_per_second,
    per_viewer: Object.fromEntries(Object.entries(watched).map(([v, s]) => [v, round6(s)])),
    total_seconds,
    total_usdc,
    recipients,
    computed_by: "deterministic-sidecar",
  };
}
