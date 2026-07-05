import { test, expect } from "bun:test";
import { NextRequest } from "next/server";
import { clientIp } from "./ratelimit";

test("x-real-ip only", () => {
  const req = new NextRequest("http://localhost/api/x", { headers: { "x-real-ip": "1.2.3.4" } });
  expect(clientIp(req)).toBe("1.2.3.4");
});

test("xff only, no x-real-ip", () => {
  const req = new NextRequest("http://localhost/api/x", { headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4" } });
  expect(clientIp(req)).toBe("9.9.9.9");
});

test("x-real-ip wins over spoofed xff", () => {
  const req = new NextRequest("http://localhost/api/x", {
    headers: { "x-real-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6" },
  });
  expect(clientIp(req)).toBe("1.2.3.4");
});
