/**
 * UX-33 [OTP] — "The send-cooldown surfaces as a generic failure that invites
 * retrying… On 429 the form should route to /verify or show the countdown
 * from the response's retryAfterSeconds."
 *
 * Grounded against the live stack (curl-probed 2026-08-19):
 *
 *   Browser-facing proxy (:5280 — what the landing form actually calls):
 *     $ curl -si POST :5280/api/auth/send-otp {"phoneNumber":"+15125556090"}
 *       → 200 {"sent":true}
 *     $ (immediately again)
 *       → HTTP/1.1 429
 *         Vary / content-type / Date …          ← NO retry-after header
 *         {"ok":false,"error":"cooldown","retryAfterSeconds":30}
 *     $ (4s after a fresh send, +15125556091)
 *       → 429 {"ok":false,"error":"cooldown","retryAfterSeconds":26}  (live!)
 *
 *   Backend directly (:4280):
 *     $ curl -si POST :4280/auth/send-otp (on cooldown)
 *       → HTTP/1.1 429 Too Many Requests
 *         retry-after: 10                        ← header IS emitted here
 *         {"ok":false,"error":"cooldown","retryAfterSeconds":10}
 *
 * So the JSON contract the FE countdown needs is ALREADY live end-to-end —
 * those assertions are labeled CONTRACT-PIN (green on purpose): they freeze
 * the shape the UX-33 front-end fix will consume, so the green agent can't
 * regress it while rewiring the form. The RED half is the standard
 * `Retry-After` header: the backend sets it
 * (backend/src/users/entrypoints/auth-controller/mod.ts:52-60, announced in
 * its own doc comment "rejected with 429 + Retry-After") but the FE proxy
 * rebuilds the response with ONLY a content-type header and drops it
 * (front-end/routes/api/auth/send-otp.ts:22-25) — the browser-facing 429 is
 * missing the very field the finding's countdown is built from. The fix:
 * forward retry-after through the proxy.
 *
 * P-03 (otp-rate-limit.int.test.ts) already pins the cooldown/attempts
 * mechanics — nothing here duplicates it; this file pins the RESPONSE SHAPE
 * the cooldown UX needs.
 *
 * Phone hygiene: reserved slice block +15125556000-6099. This file rotates
 * through +15125556040-6087 on a 31-second cycle (31s > the 30s cooldown), so
 * consecutive runs never trip the cooldown left by a prior run. 6090/6091
 * were used by the one-off curl probes above; 6001/6002/6010/6020 belong to
 * this slice's cypress specs — none overlap this range.
 */
import { anonymous } from "./helpers/api";

const SLOT = Math.floor(Date.now() / 1000) % 31; // 0..30, 31s cycle > 30s cooldown
const phoneFor = (n: 0 | 1) => `+1512555${6040 + (SLOT % 24) * 2 + n}`; // 6040..6087

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("UX-33: POST /auth/send-otp cooldown response shape (browser-facing :5280)", () => {
  // Both tests in this describe share one phone: beforeAll arms the cooldown
  // and keeps the SECOND (cooldown-hit) response for inspection.
  let second: { status: number; body: any; res: Response };

  beforeAll(async () => {
    const s = anonymous();
    const phone = phoneFor(0);
    const first = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "es",
    });
    expect(first.status).toBe(200);
    expect(first.body?.sent).toBe(true);
    second = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "es",
    });
  });

  it("UX-33: [CONTRACT-PIN, green] a cooldown-hit send is a 429 whose body carries a machine-readable marker + retryAfterSeconds", () => {
    // Green today by design — this is the shape the FE countdown fix depends
    // on; pinning it keeps the green agent from breaking it while rewiring
    // the landing form (see ux-otp-cooldown-ux.test.ts for that half).
    expect(second.status).toBe(429);
    expect(second.body?.ok).toBe(false);
    expect(second.body?.error).toBe("cooldown");
    expect(Number.isInteger(second.body?.retryAfterSeconds)).toBe(true);
    expect(second.body?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(second.body?.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("UX-33: the browser-facing 429 carries the Retry-After header the backend already sets (proxy must forward it)", () => {
    // RED today: backend auth-controller/mod.ts:52-60 sends
    // `retry-after: <n>` (curl-verified on :4280), but the FE proxy
    // front-end/routes/api/auth/send-otp.ts:22-25 rebuilds the response with
    // only a content-type header, so :5280 clients never see it.
    const header = second.res.headers.get("retry-after");
    expect(header).not.toBeNull();
    const seconds = Number(header);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(30);
  });
});

describe("UX-33: retryAfterSeconds is a live countdown", () => {
  it("UX-33: [CONTRACT-PIN, green] the seconds decrease as the cooldown elapses (usable for a real countdown)", async () => {
    // Green today by design (curl evidence: 26 remaining after ~4s) — pinned
    // because a constant 30 would make the FE countdown lie.
    const s = anonymous();
    const phone = phoneFor(1);
    const first = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "es",
    });
    expect(first.status).toBe(200);

    await sleep(3_200);

    const blocked = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "es",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body?.error).toBe("cooldown");
    // ≥3s elapsed of a 30s window → at most ceil(30 - 3) = 27 left (28 with
    // a generous scheduling cushion); never 0.
    expect(blocked.body?.retryAfterSeconds).toBeLessThanOrEqual(28);
    expect(blocked.body?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
