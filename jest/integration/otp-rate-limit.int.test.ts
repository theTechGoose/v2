/**
 * P-03 [SECURITY/COST] — "POST /api/auth/send-otp is unauthenticated with ZERO
 * rate limiting → SMS-pumping toll fraud. … Bonus hole: every re-send resets
 * attempts=0, defeating the MAX_ATTEMPTS=5 OTP brute-force guard."
 * <<solution>> set a backend 30 second cooldown per phone.
 *
 * Grounded against the live stack (curl-probed 2026-08-18):
 *   - POST /api/auth/send-otp        → 200 {"sent":true} on EVERY call today,
 *     even back-to-back for the same phone (send-otp/mod.ts:43-58 has no gate;
 *     the FE proxy front-end/routes/api/auth/send-otp.ts forwards verbatim).
 *   - POST /api/auth/verify (proxy for backend /auth/verify-otp) → wrong code
 *     gives 400 {"ok":false,"error":"invalid_code"}; after 5 wrong attempts
 *     the 6th gives {"ok":false,"error":"rate_limited"} (MAX_ATTEMPTS=5,
 *     verify-otp/mod.ts:171). But a re-send returns {"sent":true} and
 *     OtpStore.put overwrites the record with attempts:0
 *     (otp-store/mod.ts:29-40), so the very next wrong attempt is back to
 *     "invalid_code" — the lock is GONE. Desired: a resend must never reopen
 *     verification on a locked phone.
 *
 * Phone hygiene: reserved block +15125552000-2099. This file rotates through
 * +15125552000-2092 on a 31-second cycle (31s > the 30s cooldown), so
 * consecutive test runs never trip the (fixed) cooldown left by a prior run.
 * WRONG_CODE is a non-master code ("000000" would dev-bypass and mint a
 * session); collision with the real random 6-digit OTP is a 1e-6 fluke.
 */
import { anonymous } from "./helpers/api";

const SLOT = Math.floor(Date.now() / 1000) % 31; // 0..30, 31s cycle > 30s cooldown
const phoneFor = (n: 0 | 1 | 2) => `+1512555${2000 + SLOT * 3 + n}`; // 2000..2092

const WRONG_CODE = "111111";

describe("P-03: POST /auth/send-otp per-phone cooldown", () => {
  it("P-03: a second send for the same phone inside the 30s cooldown is rejected (4xx, not {sent:true})", async () => {
    const s = anonymous();
    const phone = phoneFor(0);

    const first = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "en",
    });
    expect(first.status).toBe(200);
    expect(first.body?.sent).toBe(true);

    const second = await s.post("/auth/send-otp", {
      phoneNumber: phone,
      language: "en",
    });
    // Desired: 429 (Retry-After ≈ 30s) — any 4xx rejection is acceptable,
    // but it must NOT claim another SMS was dispatched.
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(second.body?.sent).not.toBe(true);
  });

  it("P-03: the cooldown is per-phone — a different phone still sends while another is cooling down", async () => {
    const s = anonymous();
    const hotPhone = phoneFor(1);
    const otherPhone = phoneFor(2);

    const first = await s.post("/auth/send-otp", {
      phoneNumber: hotPhone,
      language: "en",
    });
    expect(first.status).toBe(200);
    expect(first.body?.sent).toBe(true);

    // Same phone again → blocked (red today: 200 {"sent":true}).
    const blocked = await s.post("/auth/send-otp", {
      phoneNumber: hotPhone,
      language: "en",
    });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(blocked.body?.sent).not.toBe(true);

    // A DIFFERENT phone right afterwards must be unaffected.
    const other = await s.post("/auth/send-otp", {
      phoneNumber: otherPhone,
      language: "en",
    });
    expect(other.status).toBe(200);
    expect(other.body?.sent).toBe(true);
  });
});

describe("P-03: a resend must not reset the verify-otp attempts lock", () => {
  it("P-03: after 5 wrong codes, a resend does not reopen verification — the next wrong code is still rate_limited", async () => {
    const s = anonymous();
    const phone = phoneFor(2);

    // Ensure an OTP record exists for this phone. Deliberately un-asserted:
    // today this always 200s; once P-03's cooldown lands, this call may be
    // 429-blocked when the previous test already sent for this phone — in
    // that case the record from that send is the one under attack, which is
    // equally valid for this scenario.
    await s.post("/auth/send-otp", { phoneNumber: phone, language: "en" });

    // Burn the MAX_ATTEMPTS=5 budget with wrong codes.
    for (let i = 1; i <= 5; i++) {
      const attempt = await s.post("/auth/verify", {
        phoneNumber: phone,
        code: WRONG_CODE,
      });
      expect(attempt.status).toBeGreaterThanOrEqual(400);
      expect(attempt.body?.ok).not.toBe(true);
      expect(attempt.body?.error).toBe("invalid_code");
    }

    // The lock is engaged: attempt #6 is rejected as rate_limited.
    const locked = await s.post("/auth/verify", {
      phoneNumber: phone,
      code: WRONG_CODE,
    });
    expect(locked.status).toBeGreaterThanOrEqual(400);
    expect(locked.body?.error).toBe("rate_limited");

    // Re-send an OTP for the locked phone. No success assertion on purpose:
    // once the P-03 cooldown exists this resend may itself be 429-blocked —
    // either way, verification must REMAIN locked afterwards.
    await s.post("/auth/send-otp", { phoneNumber: phone, language: "en" });

    // THE HOLE (red today): OtpStore.put reset attempts to 0, so this wrong
    // attempt comes back "invalid_code" — a brute-forcer just re-sends every
    // 5 guesses to reset the meter. Desired: still locked.
    const afterResend = await s.post("/auth/verify", {
      phoneNumber: phone,
      code: WRONG_CODE,
    });
    expect(afterResend.body?.ok).not.toBe(true);
    expect(afterResend.body?.error).toBe("rate_limited");
  });
});
