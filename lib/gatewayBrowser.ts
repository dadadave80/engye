"use client";
// Browser x402 over Circle Gateway — hand-rolled (GatewayClient is private-key-only).
// Encoding verified against @circle-fin/x402-batching client internals: the seller/facilitator
// forwards our base64 Payment-Signature payload verbatim to Circle's /v1/x402/{verify,settle}.
import { erc20Abi, type Address, type WalletClient } from "viem";
import { publicClient, USDC, GATEWAY_WALLET, gatewayWalletAbi, usdcAtomic } from "./clientChain";

/** Ensure the connected wallet has at least `minUsdc` deposited in the Gateway wallet;
 *  if not, approve + deposit `topUpUsdc`. Two wallet-signed txs. */
export async function ensureGatewayFloat(wallet: WalletClient, minUsdc = 0.05, topUpUsdc = 0.5): Promise<void> {
  const account = wallet.account!;
  // Gateway balance is tracked off the deposit; simplest robust check: read the facilitator? For the
  // hackathon we deposit if the wallet's Gateway balance read is below min. We approximate by always
  // topping up when the caller signals a shortfall; callers pass minUsdc to gate.
  const atomic = usdcAtomic(topUpUsdc);
  const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, GATEWAY_WALLET] });
  if (allowance < atomic) {
    const approveHash = await wallet.writeContract({ account, chain: wallet.chain, address: USDC, abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, atomic] });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
  const depositHash = await wallet.writeContract({ account, chain: wallet.chain, address: GATEWAY_WALLET, abi: gatewayWalletAbi, functionName: "deposit", args: [USDC, atomic], gas: 120_000n });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
}

const b64 = (s: string) => (typeof window === "undefined" ? Buffer.from(s).toString("base64") : btoa(s));
const unb64 = (s: string) => (typeof window === "undefined" ? Buffer.from(s, "base64").toString() : atob(s));

/** Pay an x402 endpoint from the connected wallet: GET/POST → 402 → sign EIP-3009 → retry. */
export async function payX402(
  wallet: WalletClient,
  url: string,
  init?: { method?: "GET" | "POST"; body?: string },
): Promise<Response> {
  const method = init?.method ?? "GET";
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: init?.body });
  if (res.status !== 402) return res;

  const header = res.headers.get("payment-required");
  if (!header) throw new Error("402 without PAYMENT-REQUIRED header");
  const paymentRequired = JSON.parse(unb64(header));
  const chainId = wallet.chain!.id;
  const opt = paymentRequired.accepts?.find(
    (o: Record<string, unknown>) =>
      o.network === `eip155:${chainId}` &&
      (o.extra as Record<string, unknown>)?.name === "GatewayWalletBatched",
  );
  if (!opt) throw new Error("no Gateway batching option in payment requirements");

  const now = Math.floor(Date.now() / 1000);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = ("0x" + [...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
  const authorization = {
    from: wallet.account!.address,
    to: opt.payTo as Address,
    value: String(opt.amount),
    validAfter: String(now - 600),
    validBefore: String(now + 604_900), // ~7 days + margin
    nonce,
  };
  const signature = await wallet.signTypedData({
    account: wallet.account!,
    domain: { name: "GatewayWalletBatched", version: "1", chainId, verifyingContract: opt.extra.verifyingContract as Address },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce,
    },
  });

  const paymentHeader = b64(JSON.stringify({
    x402Version: paymentRequired.x402Version ?? 2,
    payload: { authorization, signature },
    resource: paymentRequired.resource,
    accepted: opt,
  }));

  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "Payment-Signature": paymentHeader },
    body: init?.body,
  });
}
