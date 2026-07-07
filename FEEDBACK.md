# FEEDBACK.md — Circle DX friction log

Logged as hit, during the Lepton Agents Hackathon build of ENGYE (bonded x402 broker).

## 1. Conflicting EVM-version guidance for Arc
`docs.arc.network/arc/references/evm-compatibility` says Arc targets the **Prague** hard fork, but the `use-smart-contract-platform` Circle Skill instructs compiling with `evmVersion: "paris"` ("avoid PUSH0", calling Arc Testnet non-Shanghai). No `evm_version` guidance exists for direct Foundry deploys anywhere in the docs. A builder deploying with Foundry has to guess. Suggestion: one authoritative "compile targets for Arc" note in use-arc, covering solc AND vyper.

## 2. USDC dual-decimals (18 native / 6 ERC-20) is a footgun
The same balance reads as 18 decimals via `msg.value`/`eth_getBalance` and 6 decimals via the ERC-20 interface at 0x3600...0000. It IS documented, but every payment/funding code path has to remember the 10^12 factor (arc-nanopayments' own agent.mts mixes `parseEther` for gas-funding and 6-dec units for ERC-20 transfers in adjacent lines). Suggestion: a first-class helper in the SDK (e.g. `toNative(usdc6)` / `toErc20(usdc18)`), plus a loud callout in use-arc's quickstart.

## 3. arc-nanopayments sample ships stale LangChain deps
`@langchain/core`, `@langchain/openai`, `deepagents` are declared in package.json and the README claims a LangChain deep agent, but no source file imports them — the only "agent" is a non-LLM payment loop in agent.mts. Misleading for builders who clone it expecting an LLM-agent example.

## 4. x402-batching v3 silently changed the default facilitator to production
`@circle-fin/x402-batching@3.2.0`'s `BatchFacilitatorClient` defaults to `https://gateway-api.circle.com` (production). The arc-nanopayments sample pins `^2.0.4` and constructs it with no args — anyone starting fresh gets v3, and on Arc testnet the failure surfaces as a bare `unsupported_network` at pay time, with zero hint that it's a facilitator-URL problem. Suggestions: honor an env var, or make the error say which facilitator rejected which network.

## 5. ERC-8004 IdentityRegistry safe-mint breaks EIP-7702 accounts
`register()` safe-mints the agent NFT to msg.sender. A 7702-delegated EOA has code, so unless the delegate implements `onERC721Received`, registration reverts with no reason string. Confirmed on Arc testnet (plain EOA simulation passes, delegated account reverts; fixed by adding token callbacks to our delegate). Agentic wallets will increasingly BE delegated EOAs — the tutorial should call this out, and the registry's revert could be descriptive.

## 6. Arcscan contract verification for Vyper is a gauntlet (Arc explorer DX)
Verifying Vyper on testnet.arcscan.app required reverse-engineering the verifier's undocumented standard-json schema: (a) verification failures are SILENT over REST — the error only exists as a websocket event, so API users see "verification started" then nothing; (b) the schema rejects `evmVersion: "prague"` (and `"default"`) even though Arc itself targets Prague — the only path is omitting the key; (c) `optimize` must be a legacy boolean, not vyper 0.4.x's mode string; (d) `outputSelection` must be the flat form; (e) Venom builds (`experimentalCodegen`) cannot be verified at all — the field is silently dropped and the bytecode never matches, forcing us to ship default-codegen contracts; (f) multipart uploads only parse with field `files[0]` + explicit `type=application/json`. Each of these failed silently. Suggestions: surface verification errors in the REST response/a status endpoint, accept prague, accept vyper's documented settings shapes, support experimentalCodegen.

## 7. Gateway Nanopayments works with EIP-7702-delegated buyers (positive finding — document it)
Docs say buyers must be EOAs ("SCA/EIP-1271 unsupported"). We verified the nuance: a 7702-delegated EOA (code set) deposits AND pays fine end-to-end on Arc testnet, since EIP-3009 authorizations still ecrecover to the root key. Worth stating explicitly in the buyer docs — "EOA required" reads as excluding delegated EOAs, and it shouldn't.

## 8. GatewayClient is private-key-only — no browser/wallet-signer buyer path
`@circle-fin/x402-batching@3.2.0`'s `GatewayClient` constructor requires a raw `privateKey`; there is no way to hand it a viem `WalletClient`/EIP-1193 signer, so a dApp whose USER pays (MetaMask, injected, WalletConnect) cannot use the official buyer at all. We had to hand-roll the browser path — re-implement the EIP-3009 `TransferWithAuthorization` typed-data under the `GatewayWalletBatched` v1 domain and the base64 `Payment-Signature` envelope by reading the SDK's internals — the exact hand-rolling Circle's own guidance says not to do. Suggestion: accept an abstract signer (viem account / signTypedData callback) in `GatewayClient`, or ship a documented `buildPaymentSignature(authorization, signature)` helper so browser buyers stay on supported encodings.
