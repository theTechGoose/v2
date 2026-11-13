/**
 * REQ-151 — adding a worker texts the cell once: who added them, the /worker address and the
 * PIN, in the owner's language; the answer says `texted`; the PIN still never comes back in the
 * record (REQ-138). The SMS seam is the service's `send`, as the admin-invite test does.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { FieldModule } from "@field/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { FieldWorkerStore } from "@field/domain/data/field-stores/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9189;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

async function withServer(
  fn: (
    call: Call,
    texts: SendSmsInput[],
    app: DanetApplication,
  ) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  Deno.env.delete("APP_URL");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  const texts: SendSmsInput[] = [];
  app.get(SmsService).send = (input: SendSmsInput) => {
    texts.push(input);
    return Promise.resolve({ ok: true });
  };
  await app.listen(PORT);
  const call: Call = async (method, path, body, headers = {}) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    await fn(call, texts, app);
  } finally {
    await app.close();
    await resetKv();
  }
}

async function login(call: Call, language: "en" | "es") {
  const phone = "+15125551450";
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Raphael Castro", language }, H);
  return H;
}

Deno.test("REQ-151 adding a worker texts the cell once with the owner, the /worker address and the PIN; the answer says texted; the PIN never comes back", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "en");
    texts.length = 0; // the OTP text
    const made = await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "843-555-0201",
      pin: "1234",
      language: "en", // REQ-155 — the worker's language decides; Spanish when absent
    }, H);
    assertEquals(made.status, 201);
    assertEquals(made.body.texted, true, "the answer says the text went out");
    assertEquals(
      "pin" in made.body,
      false,
      "the PIN never comes back in the record (REQ-138)",
    );
    assertEquals(texts.length, 1, "one welcome text");
    assertEquals(texts[0].to, "+18435550201");
    assertEquals(
      texts[0].body,
      "Raphael Castro added you as a worker on DocuMonster. Sign in at http://localhost:5280/worker?lang=en with this number and your PIN 1234.",
    );
  });
});

Deno.test("REQ-151 a Spanish owner's worker is texted in Spanish; a refused add (a duplicate cell) texts nothing", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "es");
    texts.length = 0;
    const made = await call("POST", "/field/workers", {
      name: "Marcos",
      phoneNumber: "8435550202",
      pin: "4321",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(texts.length, 1);
    assert(
      texts[0].body.startsWith(
        "Raphael Castro te agregó como trabajador en DocuMonster. Entra en http://localhost:5280/worker",
      ),
      texts[0].body,
    );
    assert(texts[0].body.endsWith("tu PIN 4321."), texts[0].body);
    const dup = await call("POST", "/field/workers", {
      name: "Otro",
      phoneNumber: "8435550202",
      pin: "0000",
    }, H);
    assertEquals(dup.status, 409);
    assertEquals(texts.length, 1, "a refused add texts nothing");
  });
});

Deno.test("REQ-151 when the text cannot go out the worker is still added and the answer says texted: false", async () => {
  await withServer(async (call, texts, app) => {
    const H = await login(call, "en");
    texts.length = 0;
    app.get(SmsService).send = () =>
      Promise.resolve({ ok: false, reason: "unreachable" });
    const made = await call("POST", "/field/workers", {
      name: "Jorge",
      phoneNumber: "8435550203",
      pin: "1111",
    }, H);
    assertEquals(made.status, 201);
    assertEquals(made.body.texted, false);
    assertEquals(
      (await call("GET", "/field/workers", undefined, H)).body.map((
        w: { name: string },
      ) => w.name),
      ["Jorge"],
    );
  });
});

// ---- REQ-154 — the owner tool: every existing worker of an account ----
const SECRET = "test-reset-secret-0123456789";
/** rows by name — the list comes back in id order, which is random */
function byName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

const S = { "x-reset-secret": SECRET };

async function ownerWithWorkers(
  call: Call,
  phone: string,
  business: string,
  language: "en" | "es",
  workers: ([string, string, string] | [string, string, string, "en" | "es"])[],
) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Alex Rivera", language }, H);
  await call("PUT", "/profile/identity", { businessName: business }, H);
  for (const [name, cell, pin, wl] of workers) {
    assertEquals(
      (await call(
        "POST",
        "/field/workers",
        { name, phoneNumber: cell, pin, ...(wl ? { language: wl } : {}) },
        H,
      )).status,
      201,
    );
  }
  return H;
}

Deno.test("REQ-154 welcome-by-owner — refused without the secret (and with RESET_SECRET unset); a dry run lists the workers by business and texts nothing", async () => {
  await withServer(async (call, texts) => {
    await ownerWithWorkers(call, "+15125551460", "A2Z Landscape LLC", "en", [[
      "Luis",
      "8435550301",
      "1234",
    ], ["Marcos", "8435550302", "2345"]]);
    texts.length = 0;
    Deno.env.delete("RESET_SECRET");
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        business: "a2z",
      }, S)).body,
      { ok: false, error: "forbidden" },
      "unset: refused",
    );
    Deno.env.set("RESET_SECRET", SECRET);
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        business: "a2z",
      })).body,
      { ok: false, error: "forbidden" },
      "no header: refused",
    );
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        business: "a2z",
      }, { "x-reset-secret": "wrong-secret-0123456789" })).body,
      { ok: false, error: "forbidden" },
    );
    const dry = await call("POST", "/field/workers/welcome-by-owner", {
      business: "a2z",
      dryRun: true,
    }, S);
    assertEquals(dry.body.ok, true);
    assertEquals(dry.body.dryRun, true);
    assertEquals(dry.body.owner, {
      phone: "+15125551460",
      business: "A2Z Landscape LLC",
      name: "Alex Rivera",
      language: "en",
    });
    assertEquals(
      byName(
        dry.body.workers as { name: string; phone: string; texted?: boolean }[],
      )
        .map((w) => [w.name, w.phone, w.texted]),
      [["Luis", "8435550301", undefined], ["Marcos", "8435550302", undefined]],
    );
    assertEquals(texts.length, 0, "a dry run texts nothing");
    Deno.env.delete("RESET_SECRET");
  });
});

Deno.test("REQ-154 welcome-by-owner — the send texts each worker in the owner's language; the answer says texted per worker; a second call texts again (it is manual)", async () => {
  await withServer(async (call, texts) => {
    await ownerWithWorkers(call, "+15125551461", "Jardines Rivera", "es", [[
      "Luis",
      "8435550311",
      "1234",
    ], ["Marcos", "8435550312", "2345"]]);
    texts.length = 0;
    Deno.env.set("RESET_SECRET", SECRET);
    const res = await call("POST", "/field/workers/welcome-by-owner", {
      phoneNumber: "512-555-1461",
    }, S);
    assertEquals(res.body.ok, true);
    assertEquals(
      byName(res.body.workers as { name: string; texted: boolean }[])
        .map((w) => [w.name, w.texted]),
      [["Luis", true], ["Marcos", true]],
    );
    assertEquals(texts.map((x) => x.to).sort(), [
      "+18435550311",
      "+18435550312",
    ]);
    assert(
      texts[0].body.startsWith(
        "Alex Rivera (Jardines Rivera) te agregó como trabajador en DocuMonster. Entra en http://localhost:5280/worker",
      ),
      texts[0].body,
    );
    const luisText = texts.find((x) => x.to === "+18435550311")!;
    const marcosText = texts.find((x) => x.to === "+18435550312")!;
    assert(luisText.body.endsWith("tu PIN 1234."), luisText.body);
    assert(marcosText.body.endsWith("tu PIN 2345."), marcosText.body);
    Deno.env.delete("RESET_SECRET");
  });
});

Deno.test("REQ-154 welcome-by-owner — an unknown owner, a business matching nobody or more than one, and a body naming neither are refused with a reason", async () => {
  await withServer(async (call, texts) => {
    await ownerWithWorkers(call, "+15125551462", "Green Cut LLC", "en", [[
      "Luis",
      "8435550321",
      "1234",
    ]]);
    await ownerWithWorkers(call, "+15125551463", "Green Cut Pros", "en", []);
    texts.length = 0;
    Deno.env.set("RESET_SECRET", SECRET);
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        phoneNumber: "+15125559999",
      }, S)).body,
      { ok: false, error: "no_such_user" },
    );
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        business: "nobody",
      }, S)).body,
      { ok: false, error: "no_such_business" },
    );
    const many = (await call("POST", "/field/workers/welcome-by-owner", {
      business: "green cut",
    }, S)).body;
    assertEquals(many.ok, false);
    assertEquals(many.error, "ambiguous_business");
    assertEquals(many.matches.length, 2);
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {}, S)).body,
      { ok: false, error: "owner_required" },
    );
    assertEquals(texts.length, 0);
    Deno.env.delete("RESET_SECRET");
  });
});

// ---- REQ-155 — the worker's language ----
Deno.test("REQ-155/REQ-774 a worker added with no language takes the English owner's English; language es is kept and texted in Spanish; a bad language 400s", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "en");
    texts.length = 0;
    const luis = await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "8435550401",
      pin: "1234",
      language: "es",
    }, H);
    assertEquals(luis.status, 201);
    assertEquals(luis.body.language, "es", "the picked Spanish is kept");
    assert(
      texts[0].body.startsWith("Raphael Castro te agregó como trabajador"),
      texts[0].body,
    );
    const sam = await call("POST", "/field/workers", {
      name: "Sam",
      phoneNumber: "8435550402",
      pin: "2345",
    }, H);
    assertEquals(
      sam.body.language,
      "en",
      "REQ-774 — no language: the owner's (English), not Spanish",
    );
    assert(
      texts[1].body.startsWith("Raphael Castro added you as a worker"),
      texts[1].body,
    );
    assertEquals(
      (await call("POST", "/field/workers", {
        name: "Bad",
        phoneNumber: "8435550403",
        pin: "3456",
        language: "fr",
      }, H)).status,
      400,
    );
    assertEquals(texts.length, 2);
    const list = (await call("GET", "/field/workers", undefined, H)).body as {
      name: string;
      language: string;
    }[];
    assertEquals(byName(list).map((w) => [w.name, w.language]), [
      ["Luis", "es"],
      ["Sam", "en"],
    ]);
  });
});

Deno.test("REQ-155 PUT /field/workers/:id changes the language (the owner's worker only); the tool then texts in the new one; the tool's language override texts everyone in it", async () => {
  await withServer(async (call, texts) => {
    const H = await ownerWithWorkers(
      call,
      "+15125551470",
      "Cumbres LLC",
      "en",
      [["Luis", "8435550411", "1234", "es"], [
        "Marcos",
        "8435550412",
        "2345",
        "es",
      ]],
    );
    const list = (await call("GET", "/field/workers", undefined, H)).body as {
      id: string;
      name: string;
    }[];
    const luis = list.find((w) => w.name === "Luis")!;
    const put = await call("PUT", `/field/workers/${luis.id}`, {
      language: "en",
    }, H);
    assertEquals(put.status, 200);
    assertEquals(put.body.language, "en");
    assertEquals("pin" in put.body, false);
    assertEquals(
      (await call("PUT", `/field/workers/${luis.id}`, { language: "de" }, H))
        .status,
      400,
    );
    const other = await login(call, "en");
    assertEquals(
      (await call(
        "PUT",
        `/field/workers/${luis.id}`,
        { language: "es" },
        other,
      )).status,
      403,
      "another account's worker is refused, as every getOwned is",
    );
    texts.length = 0;
    Deno.env.set("RESET_SECRET", SECRET);
    const res = await call("POST", "/field/workers/welcome-by-owner", {
      business: "cumbres",
    }, S);
    assertEquals(
      byName(
        res.body.workers as {
          name: string;
          language: string;
          texted: boolean;
        }[],
      )
        .map((w) => [w.name, w.language, w.texted]),
      [["Luis", "en", true], ["Marcos", "es", true]],
    );
    const toLuis = texts.find((x) => x.to === "+18435550411")!;
    const toMarcos = texts.find((x) => x.to === "+18435550412")!;
    assert(toLuis.body.includes("added you as a worker"), toLuis.body);
    assert(toMarcos.body.includes("te agregó como trabajador"), toMarcos.body);
    texts.length = 0;
    const forced = await call("POST", "/field/workers/welcome-by-owner", {
      business: "cumbres",
      language: "es",
    }, S);
    assertEquals(forced.body.ok, true);
    assert(
      texts.every((x) => x.body.includes("te agregó como trabajador")),
      "everyone in Spanish on the override",
    );
    assertEquals(
      (await call("POST", "/field/workers/welcome-by-owner", {
        business: "cumbres",
        language: "fr",
      }, S)).body,
      { ok: false, error: "bad_language" },
    );
    Deno.env.delete("RESET_SECRET");
  });
});

// ---- REQ-285 — the worker's screen opens in the worker's language (demo customers-payments-fieldops-m3) ----
Deno.test("REQ-285 a Spanish worker's welcome link carries ?lang=es and an English one's ?lang=en; login and /me answer the worker's language", async () => {
  await withServer(async (call, texts) => {
    const H = await login(call, "en"); // an ENGLISH owner, as in the demo
    texts.length = 0;
    const luis = await call("POST", "/field/workers", {
      name: "Luis",
      phoneNumber: "8435550501",
      pin: "1234",
      language: "es",
    }, H);
    assertEquals(luis.status, 201);
    assert(
      texts[0].body.includes("http://localhost:5280/worker?lang=es "),
      texts[0].body,
    );
    const sam = await call("POST", "/field/workers", {
      name: "Sam",
      phoneNumber: "8435550502",
      pin: "2345",
      language: "en",
    }, H);
    assertEquals(sam.status, 201);
    assert(
      texts[1].body.includes("http://localhost:5280/worker?lang=en "),
      texts[1].body,
    );

    const wl = await call("POST", "/field/worker/login", {
      phoneNumber: "8435550501",
      pin: "1234",
    });
    assertEquals(wl.status, 200);
    assertEquals(
      wl.body.language,
      "es",
      "the login answer carries the worker's language",
    );
    assertEquals("pin" in wl.body, false);
    const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
    const me = await call("GET", "/field/worker/me", undefined, W);
    assertEquals(me.body.language, "es", "/me carries the worker's language");

    const sl = await call("POST", "/field/worker/login", {
      phoneNumber: "8435550502",
      pin: "2345",
    });
    assertEquals(sl.body.language, "en");
  });
});

Deno.test("REQ-285 a worker from before REQ-155 (no language on record) is answered in the owner's language, as the welcome text falls back", async () => {
  await withServer(async (call, _texts, app) => {
    const H = await login(call, "es"); // a Spanish owner
    const made = await call("POST", "/field/workers", {
      name: "Viejo",
      phoneNumber: "8435550503",
      pin: "1234",
      language: "en",
    }, H);
    const store = app.get(FieldWorkerStore);
    const rec = await store.get(made.body.id);
    delete rec.language; // the record as it was before REQ-155
    await store.put(rec);
    const wl = await call("POST", "/field/worker/login", {
      phoneNumber: "8435550503",
      pin: "1234",
    });
    assertEquals(wl.body.language, "es", "falls back to the owner's language");
  });
});

// ---- REQ-774 (demo dv1-d5) — a new worker defaults to the owner's language, not always Spanish ----
Deno.test("REQ-774 a Spanish owner's worker added with no language is Spanish and texted in Spanish; an English owner's is English", async () => {
  await withServer(async (call, texts) => {
    const es = await login(call, "es");
    texts.length = 0;
    const ana = await call("POST", "/field/workers", {
      name: "Ana",
      phoneNumber: "8435550901",
      pin: "1234",
    }, es);
    assertEquals(ana.status, 201);
    assertEquals(ana.body.language, "es");
    assert(texts[0].body.includes("/worker?lang=es "), texts[0].body);
    const en = await login(call, "en");
    texts.length = 0; // the sign-in code text
    const bob = await call("POST", "/field/workers", {
      name: "Bob",
      phoneNumber: "8435550902",
      pin: "2345",
    }, en);
    assertEquals(bob.status, 201);
    assertEquals(bob.body.language, "en");
    assert(texts[0].body.includes("/worker?lang=en "), texts[0].body);
  });
});
