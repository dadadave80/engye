# Creator-Settlement Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an x402 provider that computes creator settlement statements deterministically, onboarded via ENGYE's public registry, demoable from the hire chat.

**Architecture:** Pure settlement math in `lib/sidecarSettle.ts` (unit-tested); thin x402 route reusing `protectRoute` + `workTask` fallback; one starter chip; one README paragraph. Registration is a live curl post-deploy.

**Tech Stack:** Next 16 route handler, zod, bun test, existing `lib/x402.ts` seller middleware.

## Global Constraints

- Price 0.01 USDC (registry probe cap is 0.02). Payout wallet `PROVIDER2_ADDRESS`.
- Deliverable shape matches in-house providers: `{ provider, answer: string }`.
- Non-settlement specs (incl. the registry's "17 + 25" probe) fall back to `workTask(task, "answer")`.
- No changes to escrow/executor/settle money paths. Testnet only. No secrets committed.

---

### Task 1: Settlement math + tests

**Files:** Create `lib/sidecarSettle.ts`, `lib/sidecarSettle.test.ts`.

- [ ] `computeSettlement(job)`: sort events by time (numeric seconds or ISO-8601); pair per-viewer `joined`→`parted` (keep first of double-joins, ignore orphan `parted`); unclosed `joined` runs to max timestamp; `total_usdc = round6(total_seconds × rate)`; recipients optional (default `[{name:"creator",share:1}]`), shares normalized; returns `{method, rate_usdc_per_second, per_viewer, total_seconds, total_usdc, recipients, computed_by}`.
- [ ] `extractSettlementJob(spec)`: try fenced ```json blocks then the outermost `{…}` span; zod-validate; `null` if absent.
- [ ] Tests: pairing; unclosed join; orphan part; ISO timestamps; 6dp rounding; share normalization; default recipient; extractor on fenced/raw/absent JSON. Run `bun test lib/sidecarSettle.test.ts` → all pass.
- [ ] Commit.

### Task 2: Route + chip + README

**Files:** Create `app/api/sidecar/settle/route.ts`; modify `components/hire/HireChat.tsx` (STARTERS), `README.md`.

- [ ] Route: `extractSettlementJob(spec)` → `{provider:"obol-sidecar-settle", answer: JSON.stringify(computeSettlement(job))}`; else `workTask(task,"answer")` spread. Export `POST = protectRoute(handler, 0.01, "/api/sidecar/settle", process.env.PROVIDER2_ADDRESS ?? "", "outbound")`.
- [ ] Add STARTERS chip "Settle a Stream Session" with embedded 3-viewer event log + 90/10 recipient split (expected: alice 340s, bob 435s, carol 300s → 1075s → 0.1075 USDC).
- [ ] README: short "creator settlement" paragraph under **Become a provider** linking the Canteen article; positioning = ENGYE underwrites the sidecar's count.
- [ ] `bunx tsc --noEmit` clean, `bun run build` clean, local curl shows 402 with requirements on unpaid POST. Commit.

### Task 3: Live registration + demo verification (post-deploy)

- [ ] Push → Vercel auto-deploys; wait for READY.
- [ ] `curl -X POST https://engye.vercel.app/api/registry` with name "Obol Sidecar — Creator Settlement", endpoint `https://engye.vercel.app/api/sidecar/settle`, price 0.01, capabilities `["creator-settlement","stream-metering","extract","question-answering"]`, wallet `$PROVIDER2_ADDRESS` → expect 201 + `probe_pass`.
- [ ] Hire chat: chip → quote routes to the sidecar provider (bonded).
- [ ] Leaderboard shows the provider. Optional stretch: one paid execute → deterministic statement → validation PASS.
