# Re-point role EOAs to the verified SessionAccount — runbook

**Goal:** Move all 6 role EOAs' EIP-7702 delegation from the unverified legacy
SessionAccount `0x31dc3a57774fb5d664942adf2daf49ebf584061c` (venom build) to the
verified gen-7 SessionAccount `0xB8e55588A02fd514b5fCD3107Aec3a5b73A97dB2`,
preserving on-chain state, moving zero funds. Testnet only.

## Why it's safe (the core proof)

1. EIP-7702 `SetCode` changes only the account's **code pointer**; storage is
   untouched by definition.
2. Both delegates are the **same SessionAccount v2 source** — `SessionAccount.vy`
   has only 2 commits, both predating gen-7; `0x31dc3a…` must be v2 because
   ERC-8004 `safeMint` (needs `onERC721Received`, v2-only) worked live in Phase 3.
   Only the codegen backend differs (venom → default), which does **not** affect
   Vyper storage layout.
3. Confirmed layout (identical in both builds): `manager` → slot 0,
   `signers` (HashMap) → slot 1. New bytecode reads the same slots, so after
   re-point `manager()` still returns ROOT and `signers[session]` is still true.
4. **Reversible:** re-pointing back to `0x31dc3a…` is one type-4 tx per role and
   restores the exact prior state. No fund or state loss is possible.

Normal ops are unaffected: the agent operates each role by calling
`role.execute(...)` directly with the SESSION key (SESSION is a direct signer),
not via a root hop. The re-point preserves the signer set.

## Why NOT `scripts/delegate-roles.ts`

- Its steps 2/3 root-hop via the **old** SessionAccount `execute(address,uint256,bytes)`
  on ROOT — but ROOT is now delegated to **IthacaAccount** (ERC-7821
  `execute(bytes32,bytes)`) → reverts.
- P1 / P3 / VALIDATOR are below their funding targets, so step 3 fires the
  reverting hop and would move USDC out of ROOT.
- Net: partial migration, then a mid-run throw. Use a dedicated script that does
  **only** the type-4 re-delegation.

## State snapshot (captured 2026-07-05)

| Role | EOA | delegate now | native USDC |
|---|---|---|---|
| BROKER | `0x605AD2…e9Bf` | `0x31dc3a…` | 25.23 |
| DEMAND | `0xe0C04a…7D70` | `0x31dc3a…` | 10.23 |
| P1 | `0x0E3fAB…826C` | `0x31dc3a…` | 0.34 |
| P2 | `0xa08Ce6…58E0` | `0x31dc3a…` | 0.50 |
| P3 (flaky) | `0xABC112…d3eD` | `0x31dc3a…` | 0.46 |
| VALIDATOR | `0xfE0a51…C96d` | `0x31dc3a…` | 0.36 |

SESSION `0x5056b0…A0E9`: 3.06 USDC (pays gas). ROOT `0xDAda…C751`: 381.98 USDC.
Target verified delegate `0xB8e555…7dB2`: `is_verified: true`, SessionAccount vyper 0.4.3.

## The script — `scripts/repoint-roles.ts`

Does one thing per role: if the 7702 designator ≠ new delegate, sign a fresh
authorization (role signs with its own key, `nonce = role's tx count`) and send
the type-4 tx from SESSION. **No** calldata (never re-`initialize()` — manager is
already set; `initialize` would revert anyway), **no** root hop, **no** funding.
Idempotent. Reuses the proven auth mechanics from `delegate-roles.ts:52-70`.

```ts
// scripts/repoint-roles.ts — re-point role EOAs to the verified SessionAccount.
// Only the type-4 re-delegation; storage (manager, signers) survives untouched.
// Usage: bun scripts/repoint-roles.ts            (all six)
//        bun scripts/repoint-roles.ts PROVIDER3   (one role — canary)
//        bun scripts/repoint-roles.ts PROVIDER3 --to 0x31dc3a57774fb5d664942adf2daf49ebf584061c   (rollback)
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const argv = process.argv.slice(2);
const only = argv.find((a) => !a.startsWith("--"));
const toIdx = argv.indexOf("--to");
const DELEGATE = (toIdx >= 0 ? argv[toIdx + 1] : process.env.DELEGATE_ADDRESS) as `0x${string}`;
if (!DELEGATE) throw new Error("Set DELEGATE_ADDRESS in .env.local (or pass --to <addr>)");

const abi = parseAbi([
  "function manager() view returns (address)",
  "function signers(address) view returns (bool)",
]);
const transport = http(process.env.RPC ?? undefined);
const pub = createPublicClient({ chain: arcTestnet, transport });
const session = privateKeyToAccount(process.env.SESSION_PRIVATE_KEY as `0x${string}`);
const sessionWallet = createWalletClient({ account: session, chain: arcTestnet, transport });
const ROOT = process.env.ROOT_ADDRESS as `0x${string}`;

const ROLES = [
  { name: "BROKER", pk: "BROKER_PRIVATE_KEY" },
  { name: "DEMAND", pk: "DEMAND_PRIVATE_KEY" },
  { name: "PROVIDER1", pk: "PROVIDER1_PRIVATE_KEY" },
  { name: "PROVIDER2", pk: "PROVIDER2_PRIVATE_KEY" },
  { name: "PROVIDER3", pk: "PROVIDER3_PRIVATE_KEY" },
  { name: "VALIDATOR", pk: "VALIDATOR_PRIVATE_KEY" },
] as const;
const targets = only ? ROLES.filter((r) => r.name === only) : ROLES;
if (!targets.length) throw new Error(`unknown role: ${only}`);
console.log(`SESSION gas: ${formatEther(await pub.getBalance({ address: session.address }))} USDC → delegate ${DELEGATE}\n`);

const expected = `0xef0100${DELEGATE.slice(2)}`.toLowerCase();
for (const r of targets) {
  const acct = privateKeyToAccount(process.env[r.pk] as `0x${string}`);
  const role = acct.address;
  const code = ((await pub.getCode({ address: role }).catch(() => "0x")) ?? "0x").toLowerCase();
  if (code === "0x") { console.log(`${r.name} ${role}  SKIP — never delegated (use delegate-roles.ts)`); continue; }
  if (code === expected) { console.log(`${r.name} ${role}  already on ${DELEGATE}`); }
  else {
    const auth = await acct.signAuthorization({
      contractAddress: DELEGATE, chainId: arcTestnet.id,
      nonce: await pub.getTransactionCount({ address: role }),
    });
    const hash = await sessionWallet.sendTransaction({ to: role, authorizationList: [auth] });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${r.name} ${role}  re-pointed → ${DELEGATE}: ${hash}`);
  }
  // verify storage survived
  const mgr = await pub.readContract({ address: role, abi, functionName: "manager" });
  const sig = await pub.readContract({ address: role, abi, functionName: "signers", args: [session.address] });
  const ok = mgr.toLowerCase() === ROOT.toLowerCase() && sig === true;
  console.log(`   manager=${mgr} (root ${mgr.toLowerCase() === ROOT.toLowerCase() ? "✓" : "✗"})  signers[session]=${sig}  ${ok ? "OK" : "*** CHECK FAILED — halt & rollback ***"}`);
  if (!ok) throw new Error(`${r.name}: post-repoint state check failed — roll back with --to 0x31dc3a57774fb5d664942adf2daf49ebf584061c`);
}
console.log("\ndone ✓");
```

## Execution order (canary-first)

- [ ] **1. Pre-flight.** Confirm the snapshot above still holds (all 6 on
      `0x31dc3a…`, `manager()`==ROOT, `signers(session)`==true) and SESSION has gas.
- [ ] **2. Canary — PROVIDER3 only** (flaky, lowest stakes):
      `bun scripts/repoint-roles.ts PROVIDER3`
      Gate: designator → `0xB8e555…`; `manager()`==ROOT; `signers(session)`==true
      (both storage reads prove slot-0/slot-1 map correctly on the new bytecode).
- [ ] **3. Live op smoke on the canary:** run one real agent action that drives
      PROVIDER3 through the new delegate (e.g. `bun scripts/escrow-smoke.ts`, or a
      flaky-provider match). Session-signed `execute` must succeed → proves the
      dispatch/auth path runs on the new build, not just the reads.
- [ ] **4. Re-point the remaining five:** `bun scripts/repoint-roles.ts`
      (idempotent — skips PROVIDER3, does BROKER/DEMAND/P1/P2/VALIDATOR).
- [ ] **5. Post-verify all six:** every designator → `0xB8e555…`, every
      `manager()`==ROOT, `signers(session)`==true; then one end-to-end broker
      quote→bond→release to prove the agent still operates every role.
- [ ] **6. Arcscan:** confirm the now-targeted delegate `0xB8e555…` shows
      `is_verified: true` (already true) — the roles now run verified code.

## Rollback

Any check fails → re-point that role back, one tx, exact restore:
`bun scripts/repoint-roles.ts <ROLE> --to 0x31dc3a57774fb5d664942adf2daf49ebf584061c`
Storage is never touched, so rollback is total.

## Cleanup after green

- `.env.local` `DELEGATE_ADDRESS` is already `0xB8e555…` — no change.
- Update CLAUDE.md: the 6 roles now run the **verified** SessionAccount
  `0xB8e555…`; drop the "roles actually on unverified `0x31dc3a…`" discrepancy.
  Satisfies the "every deploy ships verified" rule for what's live behind the roles.
- `app/api/status/route.ts` already reports `0xB8e555…` — now finally accurate.

## Cost / risk

6 type-4 txs from SESSION (< 0.01 USDC gas total, testnet). No funds moved from
ROOT or roles. Fully reversible per role. Canary bounds worst case to one
low-value provider, rolled back in one tx.
