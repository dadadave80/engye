# ENGYE — architecture

How the bonded broker works, end to end: the two money rails, the life of a match, the state
machine that governs it, and the module seams that keep it testable. The judge-facing overview is
in the [README](README.md); this is the deeper map.

## The two money rails

Two USDC rails on Arc, never conflated: **Rail A** moves service payments (offchain-signed,
gasless, batch-settled by Circle Gateway), **Rail B** moves the accountability money (bonds,
stakes, refunds) through ENGYE's Vyper contracts.

```mermaid
flowchart LR
  subgraph railA["Rail A — service payments · gasless x402"]
    EOA["EOA wallet<br/>(EIP-3009 typed data)"] --> GW["Circle Gateway<br/>batched settlement"]
    BRK["ENGYE broker<br/>pays every provider"] --> GW
  end
  subgraph railA2["Rail A′ — passkey payments"]
    PK["passkey MSCA<br/>(gasless userOp transfer)"] --> BIND["server relay binds tx to quote<br/>before the hash is public"]
  end
  subgraph railB["Rail B — bonds · stakes · refunds"]
    BE[BondedEscrow]
    PS[ProviderStake]
    RV[RefundVault]
  end
  GW -.settles USDC on.-> ARC[("Arc<br/>USDC-native gas")]
  BIND -.plain USDC transfer on.-> ARC
  BE & PS & RV -.-> ARC
```

*Why Rail A′ exists: a passkey has no raw private key, so it cannot sign the `ecrecover`-based
EIP-3009 authorization Gateway needs — it pays by plain transfer instead, and the server creates
the tx↔quote binding before the hash is ever public, closing rebind/replay attacks.*

## The life of a match

```mermaid
sequenceDiagram
  actor R as Requester<br/>(human or agent)
  participant B as ENGYE server
  participant C as Arc contracts
  participant P as Provider
  participant V as Blind validator
  participant E as ERC-8004 registries

  R->>B: POST /api/broker/quote
  Note over B: LLM routes + states confidence c —<br/>server re-derives every number + EV gate
  B-->>R: bonded quote — price, c, bond (1–5× price)
  R->>B: execute + payment (x402 or passkey)
  B->>C: BondedEscrow.create_bond(matchKey, bond, decisionHash)
  Note over B,C: keccak of the FULL decision JSON commits<br/>on-chain before any money moves
  B->>E: validationRequest(matchKey)
  B->>P: gasless x402 payment → work
  P-->>B: deliverable
  B-->>R: delivered_awaiting_verdict + public /m permalink
  Note over B,V: ~2 minute public verdict window
  B->>V: blind validate — spec vs deliverable, provider unseen
  V-->>B: pass + score (stored exactly once, canonical)
  alt verdict: pass
    B->>C: release(matchKey) — bond back to broker
  else verdict: fail
    B->>C: slash(matchKey) — bond to requester
    B->>C: slash_stake — provider stake to requester
    B->>C: vault refund — price back to requester
  end
  B->>E: validationResponse + giveFeedback (one bytes32 matchKey links it all)
```

Settlement is a **step-idempotent, resumable sweep**: any step may have already run in an attempt
that died, so every step re-derives "already done?" from on-chain state, never DB flags. A
permissionless `POST /api/settle` re-drives anything past its window, and the bond's permissionless
`claim_timeout()` is the on-chain floor beneath everything.

## The match state machine

This diagram is generated from the single source of truth — the `TRANSITIONS` table in
[`lib/matchLifecycle.ts`](lib/matchLifecycle.ts). Every status write in the codebase is a guarded
compare-and-set (`UPDATE … WHERE status IN legalFroms(to)`), so an edge that isn't drawn here
**cannot happen** in the database.

```mermaid
stateDiagram-v2
  [*] --> pending: match created
  pending --> bonded: bond posted on-chain
  pending --> paid: unbonded best-effort path
  bonded --> paid: provider paid, deliverable stored
  paid --> awaiting_verdict: public verdict window opens
  awaiting_verdict --> validating: settler claims the lease
  validating --> validating: stale lease reclaimed
  validating --> delivered: pass — bond released
  validating --> failed_compensated: fail — slash + stake-slash + refund
  validating --> settle_retry: transient failure
  settle_retry --> validating: sweep retries
  settle_retry --> delivered: lease-outliving settler finalizes
  settle_retry --> failed_compensated: lease-outliving settler finalizes
  pending --> error: route died mid-lifecycle
  bonded --> error: route died mid-lifecycle
  paid --> error: route died mid-lifecycle
  awaiting_verdict --> error: route died mid-lifecycle
  error --> validating: sweep remediates (bonded)
  delivered --> [*]
  failed_compensated --> [*]
```

The overloaded terminal — DB `delivered` means both *bonded verdict-pass* and *unbonded handover* —
is disambiguated in exactly one function, `outcome()`, which every reader uses.

## Module seams

The money path is built around four injectable seams, so the settlement engine is unit-tested with
fakes (no chain, no DB, no LLM) and runs live with the defaults:

```mermaid
flowchart TD
  route["execute route<br/>(orchestration: pay → bond → deliver)"] --> MF["MatchForward<br/>guarded forward status writes"]
  sweep["/api/settle sweep · after() hook"] --> SETTLE["settleMatch<br/>(recovery driver)"]
  SETTLE --> MS["MatchStore<br/>persistence seam: lease claim,<br/>verdict-once, finalize"]
  SETTLE --> SC["SettleChain<br/>on-chain effects: release / slash /<br/>stake-slash / refund + already-done guards"]
  SETTLE --> ST["SettleTail<br/>ERC-8004 response + feedback<br/>(best-effort, money-free)"]
  MF --> RB["matchLifecycle<br/>THE RULEBOOK: statuses,<br/>transition table, outcome()"]
  MS --> RB
  SC --> CH["chain adapter<br/>arcPublic / arcClients / sendTx"]
  ST --> CH
  readers["queries · reputation · agora · UI"] --> RB
  CH --> ARC[("Arc testnet")]
  MS --> DB[("Supabase")]
  MF --> DB
  classDef seam stroke-dasharray: 5 5;
  class MF,MS,SC,ST seam
```

## Invariants worth knowing

- **Decision hash before money** — the broker's full decision JSON is committed on-chain in the same
  tx that locks the bond; the reasoning behind every dollar is tamper-evident.
- **Verdict exactly once** — a unique index + insert-then-reread means no settler ever proceeds on an
  unpersisted verdict; once money moves, the verdict can never be recomputed.
- **On-chain state decides "already done"** — resume-after-death guards read the contracts
  (`bond.status`, `slashed_for`, `refunded`), never revert-message strings or DB flags.
- **Post-money writes never abort a delivery** — persistence hiccups degrade to the recovery sweep;
  illegal status jumps are refused at the database and logged.
- **`claim_timeout()` is the floor** — if every server process dies, the requester can still recover
  the bond permissionlessly after the deadline.

## Stack

Next.js 16 (App Router) · Bun · [eve](https://www.npmjs.com/package/eve) (chat transport for
`/hire`) · Supabase (persistence + realtime) · viem · Vyper 0.4.3 + Foundry · Groq (per-role
models, server-re-derived outputs). Contract addresses: see the
[README's deployed-contracts table](README.md#deployed-contracts-all-verified-on-arcscan).
