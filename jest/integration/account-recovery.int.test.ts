/**
 * REQ-039 — NW-52 (p58): closing an account flags it; signing in again with
 * the same phone offers "recover" or "start fresh" instead of silently
 * reopening the old account (or creating a duplicate).
 *
 * Dev master OTP (000000) drives /auth/verify like every spec does.
 */
const BASE = process.env.API_BASE_URL ?? "http://localhost:5280/api";

async function post(path: string, body: unknown, cookie?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  return { status: r.status, body: parsed, cookie: r.headers.get("set-cookie") ?? undefined };
}

function sessionCookie(setCookie: string | undefined): string {
  return (setCookie ?? "").split(";")[0];
}

describe("REQ-039 NW-52 soft-deleted account → recover or start fresh", () => {
  const PHONE = "+15125550905";

  /** The dev KV persists across runs: a phone left closed by an earlier run
   *  answers `recoverable` — start fresh so the test begins on a live account. */
  async function liveLogin(phone: string) {
    const r = await post("/auth/verify", { phoneNumber: phone, code: "000000" });
    // The /api proxy answers 409 for a closed account (loud for scripts).
    if (r.body.recoverable === true) {
      return post("/auth/start-fresh", { token: r.body.recoveryToken });
    }
    return r;
  }

  it("REQ-039 after DELETE /me, verify returns recoverable; recover reopens the same account", async () => {
    const first = await liveLogin(PHONE);
    expect(first.status).toBe(200);
    const oldId = first.body.userId as string;
    const cookie = sessionCookie(first.cookie);
    await fetch(`${BASE}/me`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Old Owner" }) });
    const del = await fetch(`${BASE}/me`, { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);

    // Through the /api proxy a closed account is a loud 409 — nothing signed in.
    const again = await post("/auth/verify", { phoneNumber: PHONE, code: "000000" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("account_closed");
    expect(again.body.recoverable).toBe(true);
    expect(typeof again.body.recoveryToken).toBe("string");
    expect(again.body.sessionId).toBeUndefined();
    expect(again.cookie).toBeUndefined();

    const rec = await post("/auth/recover", { token: again.body.recoveryToken });
    expect(rec.status).toBe(200);
    expect(rec.body.userId).toBe(oldId);
    const me = await fetch(`${BASE}/me`, { headers: { cookie: sessionCookie(rec.cookie) } });
    expect(me.status).toBe(200);
    expect((await me.json()).name).toBe("Old Owner");
  });

  it("REQ-039 start fresh creates a new account on the same phone; the old one stays flagged", async () => {
    const PHONE2 = "+15125550906";
    const first = await liveLogin(PHONE2);
    const oldId = first.body.userId as string;
    await fetch(`${BASE}/me`, { method: "DELETE", headers: { cookie: sessionCookie(first.cookie) } });
    const again = await post("/auth/verify", { phoneNumber: PHONE2, code: "000000" });
    expect(again.status).toBe(409);
    expect(again.body.recoverable).toBe(true);
    const fresh = await post("/auth/start-fresh", { token: again.body.recoveryToken });
    expect(fresh.status).toBe(200);
    expect(fresh.body.isNewUser).toBe(true);
    expect(fresh.body.userId).not.toBe(oldId);
    const me = await fetch(`${BASE}/me`, { headers: { cookie: sessionCookie(fresh.cookie) } });
    expect(me.status).toBe(200);
    expect((await me.json()).id).toBe(fresh.body.userId);
    // The number now belongs to the new account: a plain login lands there.
    const third = await post("/auth/verify", { phoneNumber: PHONE2, code: "000000" });
    expect(third.body.userId).toBe(fresh.body.userId);
    expect(third.body.recoverable).toBeUndefined();
  });
});
