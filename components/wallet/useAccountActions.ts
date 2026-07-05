"use client";
// One send() the panels call regardless of connect kind:
//  - EOA (wagmi): submit each call as its own tx (no native batch)
//  - Passkey (Circle MSCA): batch the calls into one gasless userOp (Gas Station paymaster)
import { useWalletClient } from "wagmi";
import type { Hex } from "viem";
import { useWallet } from "./useWallet";
import { usePasskey } from "./passkey";
import { signAndRelay } from "./passkeyClient";
import { publicClient } from "@/lib/clientChain";
import type { Call } from "@/lib/ithaca";

export function useAccountActions() {
  const wallet = useWallet();
  const { data: walletClient } = useWalletClient();
  const { current } = usePasskey();

  /** Execute a batch of calls; returns the final tx hash. */
  async function send(calls: Call[]): Promise<Hex> {
    if (calls.length === 0) throw new Error("no calls");
    if (wallet.kind === "passkey" && current) {
      return signAndRelay(current, calls); // one batched, passkey-signed, gasless Circle userOp
    }
    if (wallet.kind === "eoa" && walletClient) {
      let last: Hex | undefined;
      for (const c of calls) {
        last = await walletClient.sendTransaction({ account: walletClient.account, chain: walletClient.chain, to: c.to, value: c.value, data: c.data });
        await publicClient.waitForTransactionReceipt({ hash: last });
      }
      return last!;
    }
    throw new Error("not connected");
  }

  return { send, wallet };
}
