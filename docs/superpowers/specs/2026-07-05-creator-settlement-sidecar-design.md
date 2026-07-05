# Creator-Settlement Sidecar — design

**Context.** Canteen's ["The Distribution Bootstrap for Payments Founders"](https://thecanteenapp.com/analysis/2026/05/28/distribution-bootstrap-payments-founders.html)
argues Gateway nanopayments + x402 make permissionless payment *sidecars* viable for self-hosted
creator software (per-second stream presence, scrobbles, playback progress). The article's gap:
every sidecar's count must be *trusted*. ENGYE's product is exactly that missing piece — bond the
settlement claim, blind-validate, slash fabrication. This feature ships the smallest live proof
before the Jul 6 deadline.

**Goal.** One x402 provider endpoint that computes creator settlement statements
*deterministically*, onboarded through ENGYE's public one-curl registry, demoable from the hire
chat: quote → bond → compute → validate → settle.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Endpoint path | `app/api/sidecar/settle/route.ts` | "Sidecar" is the article's concept; NOT under `/api/inhouse/` — registered via the public registry (`in_house: false`), so it exercises the external-provider onboarding path |
| Payout wallet | `PROVIDER2_ADDRESS` (existing role wallet, user decision) | Broker pays probes (conflict), demand buys (conflict), validator must stay blind (conflict), P3 is deliberately flaky. P2 has a clean record. Caveat: shares P2's stake-slash exposure — acceptable on testnet |
| Price | 0.01 USDC | Under the 0.02 probe cap (registry 422s above it) |
| Settlement math | Pure function in `lib/sidecarSettle.ts`, no LLM | Deterministic ⇒ high validation pass-probability, zero Groq spend on the hot path |
| Probe compatibility | Non-settlement specs fall back to `workTask(task, "answer")` | The registry probe is a fixed generic task ("what is 17 + 25?") — a parser-only endpoint would flunk its own onboarding |
| Task type in chat | `extract` | Already in `get_quote`'s enum; a settlement statement is structured JSON extraction. No enum change |

## Components

**1. `lib/sidecarSettle.ts`** — `computeSettlement(input)` pure function.
Input (found as a fenced/raw JSON object inside the task spec):
```json
{
  "rate_usdc_per_second": 0.0001,
  "events": [
    { "viewer": "alice", "event": "joined", "t": 0 },
    { "viewer": "alice", "event": "parted", "t": 340 }
  ],
  "recipients": [{ "name": "streamer", "share": 0.9 }, { "name": "platform", "share": 0.1 }]
}
```
Rules: pair each viewer's `joined`→`parted` (`t` in seconds or ISO-8601); an unclosed `joined`
runs to the max timestamp in the log; ignore orphan `parted`; sum per-viewer seconds;
`total_usdc = total_seconds × rate` rounded to 6dp; `recipients` optional — absent ⇒ a single
100% `creator` recipient; normalize shares when present; output
`{ per_viewer, total_seconds, rate_usdc_per_second, total_usdc, recipients, method }`.
Also exports `extractSettlementJob(spec)` — finds + validates (zod) the JSON job in a spec
string, `null` if absent.

**2. `app/api/sidecar/settle/route.ts`** — x402 seller via the existing `protectRoute(handler,
0.01, "/api/sidecar/settle", PROVIDER2_ADDRESS, "outbound")`. Handler: `extractSettlementJob(spec)`
→ deterministic statement as `{ provider, answer: JSON.stringify(statement) }`; else
`workTask(task, "answer")` fallback (probe path). Mirrors the in-house deliverable shape.

**3. Hire-chat starter chip** (`components/hire/HireChat.tsx` STARTERS): "Settle a Stream
Session" — prefilled spec asking for the settlement statement of a small embedded event log
(3 viewers / rate / 90-10 recipient split), keywords "stream session settlement" so the broker
routes to the sidecar's `creator-settlement` capability.

**4. Registration (live op, post-deploy)** — the public curl, which IS part of the demo:
`POST https://engye.vercel.app/api/registry` with name "Obol Sidecar — Creator Settlement",
endpoint `https://engye.vercel.app/api/sidecar/settle`, price 0.01, capabilities
`["creator-settlement", "stream-metering", "extract", "question-answering"]`, wallet
`$PROVIDER2_ADDRESS`. Passes SSRF (public https), treasury gate (broker ~25 USDC), probe
(fallback path answers 17+25).

**5. README** — one short paragraph: ENGYE underwrites the permissionless-sidecar settlement
economy (per-second presence, per-listen, per-citation); the sidecar's count is bonded,
validated, slashable. Link the article.

## Data flow (demo)

Hire chat chip → `get_quote` (type `extract`) → broker LLM sees `creator-settlement` capability
→ bonded quote → accept (user wallet / passkey) → executor pays `/api/sidecar/settle` via x402 →
deterministic statement → blind validator scores statement vs spec → PASS → bond released.
Numbers in the deliverable are reproducible by anyone from the event log — the validator is
checking arithmetic, not vibes.

## Error handling

- Malformed event log in a real task → the zod parse fails → fallback LLM path answers as best
  it can (same failure surface as every existing provider; validator arbitrates).
- Probe/other tasks → fallback path (existing `workTask`, existing failure modes).
- No changes to money paths, settle.ts, escrow, or the executor.

## Testing

- `lib/sidecarSettle.test.ts` (bun test): pairing, unclosed join, orphan part, ISO timestamps,
  rounding to 6dp, share normalization, `extractSettlementJob` on fenced + raw + absent JSON.
- Live acceptance: (1) registration curl returns 201 + `probe_pass: true`; (2) hire-chat chip
  yields a quote routed to the sidecar provider; (3) one paid execute returns the deterministic
  statement and validation passes.

## Out of scope (post-hackathon)

Citation tolls, MusicBrainz-style payee registries, real Owncast/Jellyfin webhook listeners,
per-session EIP-3009 streaming authorizations, a dedicated provider wallet + ERC-8004 agent id.
