/// <reference types="bun-types" />
import { test, expect } from "bun:test";
import { assertPublicHttpsUrl } from "./ssrf";

// All cases below use IP literals or the protocol/localhost checks, which short-circuit
// BEFORE any DNS lookup — no network required.

test("rejects non-https", async () => {
  await expect(assertPublicHttpsUrl("http://8.8.8.8")).rejects.toThrow();
});

test("rejects malformed URLs", async () => {
  await expect(assertPublicHttpsUrl("not a url")).rejects.toThrow();
});

test("rejects localhost and internal names", async () => {
  await expect(assertPublicHttpsUrl("https://localhost")).rejects.toThrow();
  await expect(assertPublicHttpsUrl("https://svc.internal")).rejects.toThrow();
});

test("rejects private / loopback / link-local / metadata IPv4 literals", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
    await expect(assertPublicHttpsUrl(`https://${ip}`)).rejects.toThrow();
  }
});

test("accepts a public IPv4 literal over https", async () => {
  await expect(assertPublicHttpsUrl("https://8.8.8.8")).resolves.toBeUndefined();
  await expect(assertPublicHttpsUrl("https://1.1.1.1")).resolves.toBeUndefined();
});
