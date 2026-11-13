/**
 * REQ-806 — "do the approve link then as a separate endpoint so it doesnt break everyone elses
 * access": Claude asks to view an account; the 7133 phone gets a one-time approve link; a tap
 * opens a read-only, 30-minute view of that one account.
 */
import { assert, assertEquals } from "#std/assert";
import {
  approveText,
  hashToken,
  isWriteMethod,
  newToken,
  OPS_REQUEST_TTL_MS,
  OPS_VIEW_TTL_MS,
  opsStatus,
  sessionRefusal,
} from "./mod.ts";

Deno.test("REQ-806 tokens: 32 random bytes, url-safe, never repeated; only the hash is kept", async () => {
  const a = newToken(), b = newToken();
  assert(/^[A-Za-z0-9_-]{43}$/.test(a), a);
  assert(a !== b);
  const h = await hashToken(a);
  assertEquals(h.length, 64);
  assertEquals(h, await hashToken(a));
  assert(h !== a);
});

Deno.test("REQ-806 opsStatus: pending until approved, denied or 10 minutes pass", () => {
  const t0 = Date.parse("2026-11-13T18:00:00Z");
  const req = {
    status: "pending" as const,
    expiresAt: new Date(t0 + OPS_REQUEST_TTL_MS).toISOString(),
  };
  assertEquals(OPS_REQUEST_TTL_MS, 10 * 60_000);
  assertEquals(OPS_VIEW_TTL_MS, 30 * 60_000);
  assertEquals(opsStatus(req, t0 + 60_000), "pending");
  assertEquals(opsStatus(req, t0 + OPS_REQUEST_TTL_MS + 1), "expired");
  assertEquals(
    opsStatus({ ...req, status: "approved" }, t0 + OPS_REQUEST_TTL_MS + 1),
    "approved",
  );
  assertEquals(opsStatus({ ...req, status: "denied" }, t0), "denied");
});

Deno.test("REQ-806 approveText names who is asked to be viewed, for how long, why, and the link", () => {
  const s = approveText({
    account: "A2Z Landscape LLC (+15408303528)",
    reason: "check Xpress Pay on his invoices",
    url: "https://documonster.com/ops/approve/tok",
  });
  assert(s.includes("A2Z Landscape LLC (+15408303528)"), s);
  assert(s.includes("read-only"), s);
  assert(s.includes("30 min"), s);
  assert(s.includes("check Xpress Pay on his invoices"), s);
  assert(s.endsWith("https://documonster.com/ops/approve/tok"), s);
});

Deno.test("REQ-806 sessionRefusal: a read-only view refuses every write and dies at its expiry; other sessions are untouched", () => {
  const now = Date.parse("2026-11-13T18:00:00Z");
  const view = {
    readOnly: true,
    expiresAt: new Date(now + 60_000).toISOString(),
  };
  assertEquals(isWriteMethod("GET"), false);
  assertEquals(isWriteMethod("head"), false);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    assertEquals(isWriteMethod(m), true);
  }
  assertEquals(sessionRefusal(view, "GET", now), null);
  assertEquals(sessionRefusal(view, "POST", now), "read_only");
  assertEquals(sessionRefusal(view, "GET", now + 60_001), "expired");
  // an ordinary session — no readOnly, no expiresAt — is never refused here
  assertEquals(sessionRefusal({}, "POST", now), null);
  assertEquals(sessionRefusal({}, "DELETE", now + 10 ** 12), null);
});
