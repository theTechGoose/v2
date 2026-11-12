import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, FilesModule] })
class TestApp {}

const PORT = 9060;

async function drain(res: Response): Promise<void> {
  await res.body?.cancel();
}

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** a 1×1 transparent PNG */
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function upload(port: number, sid: string, filename: string, mimeType: string, base64: string): Promise<string> {
  const rec = await fetch(`http://localhost:${port}/files`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ filename, mimeType, base64 }),
  }).then((r) => r.json());
  return rec.id;
}

async function putLogo(port: number, sid: string, logoFileId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${port}/profile/identity`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ logoFileId }),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("business-identity e2e: GET returns null for fresh user", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const res = await fetch(`http://localhost:${port}/profile/identity`, {
      headers: { "x-session-id": sid },
    });
    assertEquals(await res.json(), null);
  });
});

Deno.test("business-identity e2e: PUT then GET returns the saved identity", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const created = await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ businessName: "Riley Roofing Co.", businessLicense: "TX-123" }),
    }).then((r) => r.json());
    assertEquals(created.businessName, "Riley Roofing Co.");
    assertEquals(created.businessLicense, "TX-123");

    const got = await fetch(`http://localhost:${port}/profile/identity`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(got.businessName, "Riley Roofing Co.");
  });
});

Deno.test("business-identity e2e: PUT merges instead of overwriting", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    await drain(await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ businessName: "Riley Roofing Co.", businessLicense: "TX-123" }),
    }));
    const logo = await upload(port, sid, "logo.png", "image/png", PNG_BASE64); // REQ-252: a real image
    const merged = await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ logoFileId: logo }),
    }).then((r) => r.json());
    assertEquals(merged.businessName, "Riley Roofing Co.");      // preserved
    assertEquals(merged.businessLicense, "TX-123");                // preserved
    assertEquals(merged.logoFileId, logo);
  });
});

Deno.test("business-identity e2e: GET without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/profile/identity`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

Deno.test("business-identity e2e: per-user isolation — A's data invisible to B", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await drain(await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ businessName: "Riley Roofing Co." }),
    }));
    const bData = await fetch(`http://localhost:${port}/profile/identity`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bData, null);
  });
});

// ── REQ-252 (demo issue M30): a non-image file is never the business logo ──

Deno.test("REQ-252 business-identity e2e: PUT logoFileId naming a text file sent as application/pdf (the demo's factura.pdf) is 422 logo_not_image and the logo on record is unchanged", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const good = await upload(port, sid, "logo.png", "image/png", PNG_BASE64);
    assertEquals((await putLogo(port, sid, good)).status, 200);
    const junk = await upload(port, sid, "factura.pdf", "application/pdf", b64("Factura 001 — esto no es una imagen\n"));
    const res = await putLogo(port, sid, junk);
    assertEquals(res.status, 422);
    assertEquals(res.body.error, "logo_not_image");
    const got = await fetch(`http://localhost:${port}/profile/identity`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(got.logoFileId, good, "the real logo stays");
  });
});

Deno.test("REQ-252 business-identity e2e: the bytes decide, not the claimed type — text bytes uploaded as image/png are refused; a PNG is accepted", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const liar = await upload(port, sid, "logo.png", "image/png", b64("not a png at all"));
    const refused = await putLogo(port, sid, liar);
    assertEquals(refused.status, 422);
    assertEquals(refused.body.error, "logo_not_image");
    const png = await upload(port, sid, "logo.png", "image/png", PNG_BASE64);
    const ok = await putLogo(port, sid, png);
    assertEquals(ok.status, 200);
    assertEquals(ok.body.logoFileId, png);
  });
});

Deno.test("REQ-252 business-identity e2e: a file id that does not exist, or is another account's, is refused the same way", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const missing = await putLogo(port, sidA, "file-x");
    assertEquals(missing.status, 422);
    assertEquals(missing.body.error, "logo_not_image");
    const bLogo = await upload(port, sidB, "logo.png", "image/png", PNG_BASE64);
    const foreign = await putLogo(port, sidA, bLogo);
    assertEquals(foreign.status, 422);
    assertEquals(foreign.body.error, "logo_not_image");
  });
});

// ---------------------------------------------------------------------------
// REQ-348 (demo-loop cycle 1, issue m34): a Spanish-landing signup's first
// identity write seeds the languages they send in from their own language —
// Settings used to show English alone because nothing ever wrote the set.
// ---------------------------------------------------------------------------

async function loginIn(port: number, phone: string, language: "en" | "es"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, language }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function putIdentity(port: number, sid: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://localhost:${port}/profile/identity`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  });
  assertEquals(res.status, 200);
  return await res.json();
}

Deno.test("REQ-348 business-identity e2e: a Spanish signup's first identity write seeds commsLanguages [en, es]; an English one [en] (demo m34)", async () => {
  await withServer(async (port) => {
    const es = await loginIn(port, "+15125550101", "es");
    const esSaved = await putIdentity(port, es, { businessName: "Techos Rivera" });
    assertEquals(esSaved.commsLanguages, ["en", "es"]);
    // the default send language is untouched — the first send still adopts its pick
    assertEquals(esSaved.commsLanguage, undefined);
    const en = await loginIn(port, "+15125550102", "en");
    assertEquals((await putIdentity(port, en, { businessName: "Rivera Roofing" })).commsLanguages, ["en"]);
  });
});

Deno.test("REQ-348 business-identity e2e: a pick is never overridden — an explicit set stands, later writes keep it", async () => {
  await withServer(async (port) => {
    const sid = await loginIn(port, "+15125550103", "es");
    assertEquals((await putIdentity(port, sid, { businessName: "Techos", commsLanguages: ["es"] })).commsLanguages, ["es"]);
    assertEquals((await putIdentity(port, sid, { websiteUrl: "https://techos.example" })).commsLanguages, ["es"]);
    const legacy = await loginIn(port, "+15125550104", "es");
    const kept = await putIdentity(port, legacy, { commsLanguage: "en" });
    assertEquals(kept.commsLanguages, undefined, "a legacy single choice stands — nothing is seeded over it");
  });
});

// REQ-501 (demo-loop cycle 3, M35): Settings saved an empty business name — PUT /profile/identity
// took "". Once a business has a name, a blank one is a 400 naming welcome.nameBlank and the
// stored name stays.
Deno.test("REQ-501 M35 business-identity e2e: a blank businessName is refused once one is set", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const headers = { "content-type": "application/json", "x-session-id": sid };
    const put = (body: unknown) =>
      fetch(`http://localhost:${port}/profile/identity`, { method: "PUT", headers, body: JSON.stringify(body) });

    const first = await put({ businessName: "Jensen Roofing" });
    assertEquals(first.status, 200);
    await drain(first);

    for (const blank of ["", "   "]) {
      const res = await put({ businessName: blank });
      const text = await res.text();
      assertEquals(res.status, 400, `${JSON.stringify(blank)}: ${text}`);
      assertEquals(text.includes("welcome.nameBlank"), true, text);
    }
    const kept = await fetch(`http://localhost:${port}/profile/identity`, { headers }).then((r) => r.json());
    assertEquals(kept.businessName, "Jensen Roofing");

    // other fields still save without touching the name
    const site = await put({ websiteUrl: "https://jensen.example" });
    assertEquals(site.status, 200);
    await drain(site);
  });
});

Deno.test("REQ-500 business-identity e2e: an empty send-in list is a 400 and the languages on record stand (demo cycle 3, M34)", async () => {
  await withServer(async (port) => {
    const sid = await loginIn(port, "+15125550105", "es");
    assertEquals((await putIdentity(port, sid, { commsLanguages: ["es"] })).commsLanguages, ["es"]);
    for (const commsLanguages of [[], ["fr"], ["  "]]) {
      const res = await fetch(`http://localhost:${port}/profile/identity`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify({ commsLanguages }),
      });
      assertEquals(res.status, 400, `commsLanguages ${JSON.stringify(commsLanguages)} is refused`);
      await drain(res);
    }
    const now = await fetch(`http://localhost:${port}/profile/identity`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(now.commsLanguages, ["es"], "the refused writes changed nothing");
  });
});

// ── REQ-623 (demo cycle 4, M26): the business's payment-reminder setting ──
Deno.test("REQ-623 M26 business-identity e2e: reminders { enabled, days } is saved and read back; bad cadences are a 400", async () => {
  await withServer(async (port) => {
    const sid = await login(port, "+15125550623");
    const put = (body: unknown) =>
      fetch(`http://localhost:${port}/profile/identity`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-session-id": sid },
        body: JSON.stringify(body),
      });
    const saved = await (await put({ reminders: { enabled: false, days: [7, 14] } })).json();
    assertEquals(saved.reminders, { enabled: false, days: [7, 14] });
    const got = await fetch(`http://localhost:${port}/profile/identity`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(got.reminders, { enabled: false, days: [7, 14] });

    for (const reminders of [{ enabled: true, days: [] }, { enabled: true, days: [5] }, { enabled: "yes", days: [3] }]) {
      const res = await put({ reminders });
      assertEquals(res.status, 400, `reminders ${JSON.stringify(reminders)} is refused`);
      await drain(res);
    }
    const after = await fetch(`http://localhost:${port}/profile/identity`, { headers: { "x-session-id": sid } }).then((r) => r.json());
    assertEquals(after.reminders, { enabled: false, days: [7, 14] }, "the refused writes changed nothing");
  });
});
