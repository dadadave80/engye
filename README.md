# ENGYE — The Bonded Broker

**An AI broker that stakes USDC on its own judgment. Every match bonded on Arc. Every failure compensated.**

ἐγγύη (*engýē*) — the pledge of surety, given in the agora. ENGYE routes paid [x402](https://www.x402.org/) tasks to the best provider and posts a USDC **bond** on Arc behind every match, sized by its own calibrated confidence. If the deliverable fails independent validation, the bond auto-slashes to the requester — plus a treasury refund. The broker is an underwriter: it prices its own judgment, and pays when it's wrong.

**Live:** https://engye.vercel.app · **Chain:** Arc testnet (5042002) · **Explorer:** https://testnet.arcscan.app

Built at the **Lepton Agents Hackathon** — Canteen × Circle × Arc.

---

## Why this exists

The agent economy runs on x402: agents pay each other per call, gaslessly, sub-cent. But x402 payments are **non-refundable** — you pay *before* you know the work is good. Nobody knows which of a hundred paid endpoints is trustworthy, and there's no recourse when one fails. That asymmetry is exactly what an underwriter is for.

ENGYE sits in the middle of the market and **takes the risk**: it stakes real USDC on each provider it picks, and the requester is made whole on failure. Trust becomes a priced, on-chain, auditable thing instead of a leap of faith.

## The mechanism — one line, five stations

```
QUOTE ──▶ BOND ──▶ PAY ──▶ VALIDATE ──▶ SETTLE
                                          ├─ pass → bond released to broker
                                          └─ fail → bond + stake slashed to requester, price refunded
```

1. **Quote** (LLM decision #1) — the broker reads the registry (capabilities, price, calibrated pass-rate ĉ, recent outcomes) and picks a provider, stating an honest confidence `c ∈ [0.5, 0.99]`. The server re-derives every number and enforces an expected-value gate — the model never does the arithmetic.
2. **Bond** — a USDC bond, sized `1–5×` the task price by confidence, is locked in `BondedEscrow` **with the keccak256 of the broker's full decision JSON committed on-chain before any money moves** (tamper-evident AI audit trail).
3. **Pay** — the provider is paid via **gasless x402** over Circle Gateway (batched settlement).
4. **Validate** (LLM decision #2) — a **blind, injection-hardened** validator scores the deliverable against the spec. It never sees the provider's identity; instructions embedded in a deliverable fail on merit.
5. **Settle** — pass → bond released; fail → bond **and** provider stake slashed to the requester, plus a once-per-match vault refund. Every verdict is posted to the canonical **ERC-8004** registries.

One `bytes32` match key links escrow, validation, and reputation across contracts. If ENGYE ever dies mid-match, the bond's **permissionless `claim_timeout()`** lets anyone rescue the requester's funds after the deadline — the requester never depends on the broker staying alive.

## What to look at (judges)

- **[Dashboard](https://engye.vercel.app/dashboard)** — the live match feed (realtime), bonds-at-risk, and the Decisions rail showing the broker's actual reasoning per match. Every settled row links to Arcscan.
- **[Calibration](https://engye.vercel.app/calibration)** — *the proof the AI decides.* Stated confidence vs. realized pass rate. Perfectly calibrated judgment sits on the gold line; bonds are priced from this curve.
- **[Providers](https://engye.vercel.app/providers)** — the reputation leaderboard and one-form onboarding (probe → paid call → validator-scored prior).
- **[Status](https://engye.vercel.app/status)** — live on-chain treasury / vault / escrow balances and the verified contract set. The ledger reconciles.
- **[/api/status](https://engye.vercel.app/api/status)** — machine-readable health + reconciliation.

## Architecture

Two USDC rails on Arc, never conflated:
- **Rail A — x402 service payments:** offchain-signed, gasless, batch-settled via **Circle Gateway Nanopayments** (`@circle-fin/x402-batching`).
- **Rail B — bonds, stakes & refunds:** on-chain USDC transfers through ENGYE's Vyper contracts.

```
Requester ─x402─▶ /api/broker/quote (LLM: route + confidence + bond)
                  /api/broker/execute (x402-gated)
                        ├─ BondedEscrow.create_bond (+ decision hash)     ── Arc
                        ├─ ERC-8004 validationRequest                     ── Arc
                        ├─ Gateway x402 pay provider (gasless)            ── Circle
                        ├─ validator agent (blind, injection-hardened)
                        ├─ ERC-8004 validationResponse (+ deliverable hash)── Arc
                        ├─ release │ slash + stake-slash + vault refund   ── Arc
                        └─ ERC-8004 giveFeedback (feedbackHash = matchKey)── Arc
```

**Stack:** Next.js 16 (App Router) · Bun · Supabase (persistence + realtime) · viem · Vyper 0.4.3 + Foundry · Groq (per-role: broker `gpt-oss-120b`, validator/demand `gpt-oss-20b`, failover `qwen3-32b`).

### Deployed contracts (all verified on Arcscan)

| Contract | Address |
|---|---|
| BondedEscrow | [`0x8565139c5702A8213Fc14F29E7DaeED4FD802a83`](https://testnet.arcscan.app/address/0x8565139c5702A8213Fc14F29E7DaeED4FD802a83?tab=contract) |
| RefundVault | [`0x4FB0FcB9832006604bd81c1a0059E78774774795`](https://testnet.arcscan.app/address/0x4FB0FcB9832006604bd81c1a0059E78774774795?tab=contract) |
| ProviderStake | [`0xf226A3B41bfb503c69F4cF99E19589795AF52265`](https://testnet.arcscan.app/address/0xf226A3B41bfb503c69F4cF99E19589795AF52265?tab=contract) |
| SessionAccount (EIP-7702 delegate) | [`0xB8e55588A02fd514b5fCD3107Aec3a5b73A97dB2`](https://testnet.arcscan.app/address/0xB8e55588A02fd514b5fCD3107Aec3a5b73A97dB2?tab=contract) |
| IthacaAccount (root delegate) | [`0x37014923e41C96671ebf5c700aF38B3e728077aa`](https://testnet.arcscan.app/address/0x37014923e41C96671ebf5c700aF38B3e728077aa?tab=contract) |

Agents hold canonical **ERC-8004** identity NFTs (Identity `0x8004A818…`, Reputation `0x8004B663…`, Validation `0x8004Cb1B…`): ENGYE `845015`, providers `845016–845018`, validator `845019`.

### Account model — EIP-7702, no faucet

The human's funded keystore EOA is the **root**; it 7702-delegates to a verified **IthacaAccount** implementation and authorizes the agent's revocable **session key** (Secp256k1 super-admin) — the agent operates without ever holding the root key. **Passkey / WebAuthn** signers work too: a software P-256 passkey was authorized and signed a live intent on-chain (Solady's P256 verifier is present on Arc). The six role accounts (broker, demand, 3 providers, validator) are themselves 7702 smart accounts managed by the root.

## Circle stack used

Gateway Nanopayments (`@circle-fin/x402-batching`, gasless x402, batched settlement) · USDC-native gas on Arc · five contracts (four Vyper + the Solidity IthacaAccount) deployed **and verified** on Arc testnet · canonical ERC-8004 registries · Circle CLI + Circle Skills in the build workflow · faucet-free via EIP-7702.

## Become a provider

Any x402 endpoint can register and receive paid demand. One call:

```bash
curl -X POST https://engye.vercel.app/api/registry \
  -H 'content-type: application/json' \
  -d '{"name":"your-agent",
       "endpoint_url":"https://api.you.dev/task",
       "price_usdc":0.01,
       "wallet_address":"0xYourWallet",
       "capabilities":["summarization","question-answering"]}'
```

ENGYE probes it (expects a well-formed HTTP 402), makes one real paid call, and the validator scores it into a starting reputation. You keep 100% of your price; ENGYE's fee is on top. Show your standing with the live badge: `https://engye.vercel.app/api/badge/<provider_id>`.

## Trust assumptions (honest)

- For the hackathon, ENGYE's own validator agent is the escrow resolver — but its verdicts are posted publicly to the canonical ERC-8004 Validation Registry per match, and the bond's timeout claim is trustless. Roadmap: third-party validators staking on their verdicts.
- The in-house "Budget Answers" provider fabricates plausible-but-wrong output ~35% of the time **on purpose**, so slashes visibly happen. All demand-agent traffic is labeled `source=demand_agent` and split from organic volume on the dashboard.
- Testnet only. No real funds.

## Local development

```bash
bun install
cp .env.local.example .env.local   # fill in RPC, Supabase, Groq, wallet keys
bun run dev                         # app at http://localhost:3000
cd contracts && forge test          # 39 tests: escrow, vault, stake, 7702 delegate, Ithaca root
./scripts/deploy.sh                 # deploy + verify all contracts on Arcscan
```

Contracts are Vyper 0.4.3 (gas-optimized, Prague); tests are a Solidity harness deploying the `.vy` artifacts via `deployCode`. Deploys verify at deploy time — every deploy ships verified.

## License

Apache-2.0.
