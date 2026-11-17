/**
 * REQ-714 — demo-loop cycle 5, issue m58 ("worker view flashes English
 * first"). Integration: the /worker route's server-side lookup
 * (front-end/lib/worker-ssr.ts loadWorkerLang) against the real
 * FieldWorkerController. A worker signed in on a browser whose pm_lang is
 * English gets their own language back on the server, so the SSR page already
 * speaks it; no worker cookie, or a signed-out one, gives null (the route
 * keeps its old order).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { FieldModule } from "@field/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { loadWorkerLang } from "../../../../front-end/lib/worker-ssr.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9193;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: HeadersInit = {},
) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...J, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  // deno-lint-ignore no-explicit-any
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed, headers: r.headers };
}

/** the SSR seam: the backend reached over HTTP, as in dev (BACKEND_URL) */
const backend = (req: Request) => {
  const u = new URL(req.url);
  return fetch(`${BASE}${u.pathname}${u.search}`, {
    method: req.method,
    headers: req.headers,
  });
};

Deno.test("REQ-714 m58: a worker signed in on an English browser — the server-side lookup returns the worker's language; no or a dead cookie → null", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(SmsService).send = () => Promise.resolve({ ok: true });
  await app.listen(PORT);
  try {
    // an English owner
    const phone = "+15125551714";
    await call("POST", "/auth/send-otp", { phoneNumber: phone });
    const otp = await new OtpStore().get(phone);
    const v = await call("POST", "/auth/verify-otp", {
      phoneNumber: phone,
      code: otp!.code,
    });
    const H = { "x-session-id": v.body.sessionId as string };
    await call("PUT", "/me", { name: "Ana Owner", language: "en" }, H);

    // a Spanish worker (REQ-155's default) and an English one
    for (
      const [cell, language] of [["8435551714", "es"], ["8435551715", "en"]]
    ) {
      const made = await call("POST", "/field/workers", {
        name: `W ${cell}`,
        phoneNumber: cell,
        pin: "1234",
        language,
      }, H);
      assertEquals(made.status, 201);
    }

    const signIn = async (cell: string) => {
      const r = await call("POST", "/field/worker/login", {
        phoneNumber: cell,
        pin: "1234",
      });
      assertEquals(r.status, 200);
      return (r.headers.get("set-cookie") ?? "").split(";")[0];
    };
    const es = await signIn("8435551714");
    const en = await signIn("8435551715");

    const page = (cookie: string) =>
      new Request("http://app/worker", { headers: { cookie } });

    assertEquals(
      await loadWorkerLang(page(`pm_lang=en; ${es}`), { fetch: backend }),
      "es",
      "the Spanish worker's page speaks Spanish on the server",
    );
    assertEquals(
      await loadWorkerLang(page(`pm_lang=es; ${en}`), { fetch: backend }),
      "en",
    );
    assertEquals(
      await loadWorkerLang(page("pm_lang=en"), { fetch: backend }),
      null,
    );

    // signed out: the cookie no longer names a session
    await call("POST", "/field/worker/logout", undefined, { cookie: es });
    assertEquals(
      await loadWorkerLang(page(`pm_lang=en; ${es}`), { fetch: backend }),
      null,
    );
  } finally {
    await app.close();
    await resetKv();
  }
});
