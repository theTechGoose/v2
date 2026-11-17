/**
 * REQ-803 — /me/square: connect the business's own Square with its access token (checked
 * against Square — the fake here), read the connection back with no token in it (the location,
 * the seller's name, the environment, the masked token), refuse a token Square rejects, a
 * location that isn't the seller's, a malformed token; forget it. One card provider at a time:
 * Square is refused while Stripe is connected and Stripe while Square is (409, nothing stored).
 * The fake checkout page (/dev/square) serves off the real deploy (its real-deploy 404 is
 * dev-square-controller/test.ts, so this file never flips the process-wide DENO_DEPLOY).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  fakeSquareWorld,
  squareEnv,
  SquareGateway,
} from "@core/data/square-gateway/mod.ts";
import { fakeStripeWorld } from "@core/data/stripe-gateway/mod.ts";
import { SquareSettingsStore } from "@users/domain/data/square-settings-store/mod.ts";
import { StripeSettingsStore } from "@users/domain/data/stripe-settings-store/mod.ts";

// REQ-318: this file pins "off the real deploy" for the Square seam only, never by flipping the
// process-wide DENO_DEPLOY (parallel files share it; see square-gateway's `squareEnv`)
squareEnv.reader = {
  get: (k) => (k.startsWith("DENO_DEPLOY") ? undefined : Deno.env.get(k)),
};

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9803;
const J = { "content-type": "application/json" };

async function login(port: number, phone = "+15125558030"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(fn: (port: number, sid: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  // off the real deploy already (the lane never sets it); NOT deleted here — the env is the
  // process's, and deleting it would race a parallel file that sets it on purpose (REQ-286)
  await resetKv();
  fakeSquareWorld().reset();
  fakeStripeWorld().reset();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT, await login(PORT));
  } finally {
    await server.stop();
    await resetKv();
  }
}

const H = (sid: string) => ({ ...J, "x-session-id": sid });

async function put(port: number, sid: string, body: unknown) {
  const r = await fetch(`http://localhost:${port}/me/square`, {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

Deno.test("REQ-803 /me/square — not connected, then connected with the fake token: the status names the seller, the location (the first ACTIVE one), the environment and the masked token, never the token; the token is stored sealed", async () => {
  await withServer(async (port, sid) => {
    await (await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({ businessName: "Acme Roofing" }),
    })).body?.cancel();
    const before = await fetch(`http://localhost:${port}/me/square`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(before.connected, false);
    assertEquals(before.merchant.name, "Acme Roofing");

    const res = await put(port, sid, { accessToken: "EAAAfake_acme" });
    assertEquals(res.status, 200, res.text);
    assertEquals(
      res.text.includes("EAAAfake_acme"),
      false,
      "the token never comes back",
    );
    const s = JSON.parse(res.text);
    assertEquals(
      [
        s.connected,
        s.environment,
        s.fake,
        s.tokenMasked,
        s.locationId,
        s.locationName,
        s.sellerName,
        s.merchant.name,
      ],
      [
        true,
        "sandbox",
        true,
        "EAAA••••acme",
        "LFAKE_acme_main",
        "Acme Main St (fake)",
        "Acme (fake Square seller)",
        "Acme Roofing",
      ],
    );
    assert(typeof s.connectedAt === "string");

    // GET reads the same back
    const again = await fetch(`http://localhost:${port}/me/square`, {
      headers: H(sid),
    }).then((r) => r.text());
    assertEquals(again.includes("EAAAfake_acme"), false);
    assertEquals(JSON.parse(again).locationId, "LFAKE_acme_main");

    // at rest: sealed, never the token in the clear
    const me = await fetch(`http://localhost:${port}/me`, { headers: H(sid) })
      .then((r) => r.json());
    const stored = await new SquareSettingsStore().get(me.id ?? me.user?.id);
    assert(stored, "stored under the user");
    assert(stored!.tokenSealed.startsWith("v1."), "sealed");
    assertEquals(JSON.stringify(stored).includes("EAAAfake_acme"), false);
  });
});

Deno.test("REQ-803 /me/square — a pasted location id is used when it is the seller's; one that isn't is 422 location_not_found and nothing is stored", async () => {
  await withServer(async (port, sid) => {
    const bad = await put(port, sid, {
      accessToken: "EAAAfake_acme",
      locationId: "LFAKE_nope",
    });
    assertEquals(bad.status, 422, bad.text);
    assertEquals(JSON.parse(bad.text).error, "location_not_found");
    const off = await fetch(`http://localhost:${port}/me/square`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(off.connected, false, "nothing stored");

    // an INACTIVE location of the seller is refused too
    const closed = await put(port, sid, {
      accessToken: "EAAAfake_acme",
      locationId: "LFAKE_acme_closed",
    });
    assertEquals(closed.status, 422, closed.text);
    assertEquals(JSON.parse(closed.text).error, "location_not_found");

    const ok = await put(port, sid, {
      accessToken: "EAAAfake_acme",
      locationId: " LFAKE_acme_main ",
    });
    assertEquals(ok.status, 200, ok.text);
    assertEquals(JSON.parse(ok.text).locationId, "LFAKE_acme_main");
  });
});

Deno.test("REQ-803 /me/square — a token Square rejects is 422 square_rejected; a malformed token or an app id is 422 before Square is asked; nothing is stored", async () => {
  await withServer(async (port, sid) => {
    const rejected = await put(port, sid, { accessToken: "EAAAfake_bad" });
    assertEquals(rejected.status, 422, rejected.text);
    assertEquals(JSON.parse(rejected.text).error, "square_rejected");
    const junk = await put(port, sid, { accessToken: "not a token" });
    assertEquals(junk.status, 422, junk.text);
    assertEquals(JSON.parse(junk.text).error, "token_invalid");
    const appId = await put(port, sid, {
      accessToken: "sq0idp-abcdefghijklmnopqrstuv",
    });
    assertEquals(appId.status, 422, appId.text);
    assertEquals(JSON.parse(appId.text).error, "app_id_not_token");
    const missing = await put(port, sid, {});
    assertEquals(missing.status, 422, missing.text);
    const off = await fetch(`http://localhost:${port}/me/square`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(off.connected, false);
  });
});

Deno.test("REQ-803 one card provider at a time — Square is refused (409 stripe_connected) while Stripe is connected, and Stripe (409 square_connected) while Square is; disconnecting one frees the other", async () => {
  await withServer(async (port, sid) => {
    const stripe = (body: unknown, method = "PUT") =>
      fetch(`http://localhost:${port}/me/stripe`, {
        method,
        headers: H(sid),
        ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
      }).then(async (r) => ({ status: r.status, text: await r.text() }));
    const pair = {
      publishableKey: "pk_test_fake_acme",
      secretKey: "sk_test_fake_acme",
    };
    // Stripe on: written to its store directly (the Stripe connect path reads the process env,
    // which this file never relies on — see `squareEnv` above)
    const me = await fetch(`http://localhost:${port}/me`, { headers: H(sid) })
      .then((r) => r.json());
    const now = new Date().toISOString();
    await new StripeSettingsStore().put({
      userId: me.id,
      publishableKey: "pk_test_fake_acme",
      secretSealed: "v1.x.y",
      secretLast4: "acme",
      mode: "test",
      fake: true,
      accountId: "acct_fake_acme",
      accountName: "Acme (fake Stripe account)",
      connectedAt: now,
      updatedAt: now,
    });
    const sq = await put(port, sid, { accessToken: "EAAAfake_acme" });
    assertEquals(sq.status, 409, sq.text);
    assertEquals(JSON.parse(sq.text).error, "stripe_connected");
    // the Square status says which provider is on
    const st = await fetch(`http://localhost:${port}/me/square`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals([st.connected, st.otherProvider], [false, "stripe"]);

    assertEquals((await stripe(null, "DELETE")).status, 200);
    assertEquals(
      (await put(port, sid, { accessToken: "EAAAfake_acme" })).status,
      200,
    );
    const st2 = await stripe(pair);
    assertEquals(st2.status, 409, st2.text);
    assertEquals(JSON.parse(st2.text).error, "square_connected");
    const stripeStatus = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(stripeStatus.connected, false, "Stripe stayed off");
  });
});

Deno.test("REQ-803 /me/square — DELETE forgets the token; no session is 401", async () => {
  await withServer(async (port, sid) => {
    assertEquals(
      (await put(port, sid, { accessToken: "EAAAfake_acme" })).status,
      200,
    );
    const del = await fetch(`http://localhost:${port}/me/square`, {
      method: "DELETE",
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(del.connected, false);
    const me = await fetch(`http://localhost:${port}/me`, { headers: H(sid) })
      .then((r) => r.json());
    assertEquals(
      await new SquareSettingsStore().get(me.id ?? me.user?.id),
      null,
    );
    const anon = await fetch(`http://localhost:${port}/me/square`);
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
  });
});

Deno.test("REQ-803 /dev/square — the fake checkout page off the real deploy names the business and the amount (on the real deploy it does not exist: dev-square-controller/test.ts)", async () => {
  await withServer(async (port) => {
    const link = await new SquareGateway().createPaymentLink(
      "EAAAfake_acme",
      "sandbox",
      {
        idempotencyKey: "dev-page",
        name: "Invoice INV-009 · Acme Roofing",
        amountCents: 12345,
        currency: "USD",
        locationId: "LFAKE_acme_main",
        redirectUrl: "http://localhost:1/i/x?square=return",
      },
    );
    const page = await fetch(
      `http://localhost:${port}/dev/square/checkout/${link.id}`,
    );
    const html = await page.text();
    assertEquals(page.status, 200, html);
    assert(html.includes("Invoice INV-009 · Acme Roofing"), html);
    assert(html.includes("$123.45"), html);
    assert(html.includes('data-cy="fake-square-pay"'), html);
    assert(html.includes('data-cy="fake-square-cancel"'), html);
  });
});
