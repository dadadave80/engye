// SSRF guard for the public registry endpoint: providers submit arbitrary URLs that
// ENGYE then calls server-side, so a URL resolving to loopback/private/link-local/metadata
// space must be rejected before any fetch. Legitimate providers are on public IPs.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isBlockedV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || // 10/8 private
    a === 127 || // loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 169 && b === 254) || // 169.254/16 link-local (incl. cloud metadata 169.254.169.254)
    a === 0 || // "this host"
    a >= 224 // multicast/reserved
  );
}

function isBlockedV6(ip: string): boolean {
  const x = ip.toLowerCase();
  return (
    x === "::1" || // loopback
    x === "::" ||
    x.startsWith("fe80") || // link-local
    x.startsWith("fc") || // unique-local fc00::/7
    x.startsWith("fd") ||
    x.startsWith("::ffff:") // IPv4-mapped — re-check the embedded v4
  );
}

/** Throws if the URL is malformed, non-https, or resolves to any non-public address. */
export async function assertPublicHttpsUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("endpoint must be https");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("endpoint host not allowed");
  }

  // resolve ALL A/AAAA records and reject if any is non-public (defeats DNS rebinding to
  // a public+private multi-record host at check time)
  const literal = isIP(host);
  const addrs = literal
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error("endpoint host does not resolve");
      });
  if (addrs.length === 0) throw new Error("endpoint host does not resolve");

  for (const { address } of addrs) {
    const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
    if (isIP(mapped) === 4 ? isBlockedV4(mapped) : isBlockedV6(address)) {
      throw new Error("endpoint resolves to a non-public address");
    }
  }
}
