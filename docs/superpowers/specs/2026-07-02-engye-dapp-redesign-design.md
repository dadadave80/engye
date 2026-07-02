# ENGYE dApp Redesign — "Enter the Agora"

**Date:** 2026-07-02 · **Status:** approved (scope: EOA + full flow + passkey/Ithaca)

## Problem

ENGYE is a read-only dashboard over Supabase + a backend agent that holds every key and signs every on-chain action server-side. No wallet connect, no user-signed transactions. It is not a dApp — it is a web2 app that writes to a chain. The winning Agora hackathon app (Mimir Markets) is the inverse: marketing landing → **Launch App** → **Connect** wallet → users *create* and *stake* on-chain, with agents AND humans sharing one market.

## Goal

Give users genuine on-chain agency against the contracts already deployed, without undercutting the autonomous-agent story. Humans connect and act; agents keep transacting via the API — same market, side by side.

## Approach

Add a wallet layer and three user-signed flows; keep every existing read surface. Reuse the existing design system (marble/black-figure tokens + `components/ui`).

### Connect layer (two options, one context)
- **Primary — EOA (wagmi + viem):** injected/MetaMask connector, Arc testnet chain. Required for the requester pay-flow because Circle Gateway x402 buyers sign EIP-3009 via ecrecover (EOA-only — the carve-out). Also drives rail-B writes.
- **Innovation — Passkey → IthacaAccount:** WebAuthn credential → the EIP-7702/Ithaca smart-account model we proved on-chain (`root-smoke.ts`, Solady P256 verifier live on Arc). Delivers the deferred passkey enrollment UI. Signs **rail-B** actions (stake, claim) as ERC-7821 intents via `lib/ithaca.ts` encodings. Cannot sign Gateway payments (documented limitation) — so a passkey user does rail-B; the pay-flow prompts to use/fund an EOA.
- Unified `useWallet()` context exposes `{ address, kind: 'eoa'|'passkey', signContractCall, signGatewayPayment? }` so UI components don't branch on connect type except where the Gateway constraint forces it.

### Flow 1 — Requester "Post a task" (hero)
Connect (EOA) → compose `{type, spec, max_price}` → `POST /api/broker/quote` → render the live bonded quote (provider, confidence, bond, total) → **user pays from their wallet**: ensure Gateway balance (wallet-signed `deposit` if needed) → sign the x402 EIP-3009 authorization (`walletClient.signTypedData`) → `POST /api/broker/execute/{id}` with the `PAYMENT-SIGNATURE` header → stream the match to settlement → on fail, bond+refund land in the user's wallet (already on-chain). Requester wallet = the connected address (not the demand agent).
- **Technical risk:** `@circle-fin/x402-batching` `GatewayClient` is private-key oriented. RESOLVE: does it accept a viem `walletClient`/custom signer? If not, hand-roll deposit (viem `writeContract` on the Gateway wallet) + EIP-3009 typed-data sign from the connected wallet, then post the base64 signature the way `lib/x402.ts` already builds it. Investigated in parallel before building this flow.

### Flow 2 — Provider register + stake
Connect → register endpoint (`POST /api/registry`, add a wallet-signed ownership proof: sign a nonce, server `verifyMessage`) → **stake co-insurance**: wallet-signed `USDC.approve(ProviderStake)` + `ProviderStake.stake(amount)`; show staked balance, `request_unstake`, cooldown timer, `withdraw`. Pure rail-B; works with EOA or passkey. Visibly moves the leaderboard.

### Flow 3 — Rescue a stuck bond (anyone)
On an expired OPEN match, a "Claim for requester" button calls the permissionless `BondedEscrow.claim_timeout(matchKey)` from the connected wallet. Proves the escrow is trustless. EOA or passkey.

## App structure (Mimir-style)
- `/` marketing landing (keep) + a persistent **Launch App** / **Connect** affordance.
- App shell nav: Dashboard · Providers · Calibration · **Post a Task** · **Stake** · Status · Connect(account menu). Connect button top-right on every app page.
- New: `WalletProvider` (wagmi config + passkey adapter), `ConnectButton`, `AccountMenu`, `PostTaskForm` (+ live quote + pay), `StakePanel`, `ClaimButton`, `PasskeyEnroll`.

## Components / files
- `components/wallet/` — `WalletProvider.tsx` (wagmi), `passkey.ts` (WebAuthn→Ithaca adapter over `lib/ithaca.ts`), `ConnectButton.tsx`, `AccountMenu.tsx`, `useWallet.ts`.
- `lib/gatewayBrowser.ts` — browser x402 deposit + EIP-3009 signing (per risk resolution).
- `lib/contractsClient.ts` — client-side viem bindings for `ProviderStake.stake/request_unstake/withdraw`, `BondedEscrow.claim_timeout` (reads chain, wallet signs).
- `app/post/page.tsx`, `app/stake/page.tsx`; extend `app/providers/page.tsx` (stake), dashboard rows (claim on expired).
- `app/api/registry` — add optional signature verification.

## What stays / out of scope
- All server-side agent code, the demand agent, the LLM broker/validator, the ERC-8004 lifecycle — unchanged. Humans are additive, not a replacement.
- No new contracts (functions already exist and are verified).
- Provider `create_bond`/`release`/`slash` stay resolver-only (that's ENGYE's underwriting job — correct).

## Build order (each step shippable)
1. Wallet foundation: wagmi + Arc chain + `WalletProvider` + `ConnectButton` + account menu, mounted in the app shell. → "Connect" is real.
2. Flow 2 (stake) + Flow 3 (claim): quick user-signed rail-B writes. → "it's a dApp" today.
3. Flow 1 (requester post-and-pay): the hero; after the GatewayClient-signer risk resolves.
4. Passkey/Ithaca connect + enrollment UI: the innovation layer; additive.

## Success
A judge connects a wallet, posts a task, pays for it themselves, watches ENGYE bond+route+settle it, and (via the flaky provider) can see a slash land compensation in their own wallet — or stakes as a provider and climbs the board. Real user-signed transactions on Arcscan, initiated from the browser.
