import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";

/**
 * REQ-260 — demo issue M24 over the booted app: "Suggested prices far too
 * low for a full bathroom gut ($1,450 / $1,750 / $2,100)" — under a $2,800
 * plumbing sub the contractor typed. POST /agents/job-details/prices takes
 * the ORIGINAL message (`raw`) plus the confirmed bullets (`scope`), and no
 * tier it answers is below a cost the contractor stated. Runs on the stub LLM
 * (its "(stub) …" echo is not JSON → the generic tiers), which is exactly the
 * case the floor must still hold for.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9261;
const J = { "content-type": "application/json" };

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(
  base: string,
  phoneNumber = "+15125552600",
): Promise<string> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber }),
  }))
    .body?.cancel();
  const stored = await new OtpStore().get(phoneNumber);
  const v = await (await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber, code: stored!.code }),
  })).json();
  return v.sessionId;
}

const RAW =
  "Full gut of the hall bathroom. Demo to studs, cut the slab for a curbless shower — " +
  'my plumber quoted $2,800 for rough-in and finish. Frameless glass, 72" double vanity, permit included.';
const SCOPE =
  "Demolish bathroom to studs\nReroute drain for curbless shower\nInstall tile, vanity and glass";

Deno.test("REQ-260 M24 e2e: POST /agents/job-details/prices with {raw, scope} answers three ascending tiers, none below the $2,800 the contractor stated", async () => {
  await withServer(async (base) => {
    const sid = await login(base);
    const res = await fetch(`${base}/agents/job-details/prices`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ raw: RAW, scope: SCOPE }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    const cents = (body.options as Array<{ priceCents: number }>).map((o) =>
      o.priceCents
    );
    assertEquals(cents.length, 3);
    for (const c of cents) {
      assert(c > 280000, `every tier above the stated $2,800: ${cents}`);
    }
    assert(cents[0] < cents[1] && cents[1] < cents[2], `ascending: ${cents}`);
    assertEquals(body.basis, "labor_and_materials");
  });
});

// ── REQ-332 — demo cycle 1, m30 over the booted app ────────────────────
// 'Professionalize' changed the meaning (a job-wide permit re-scoped onto one
// item) and "Prices include labor and materials" though the client buys the
// vanity. Stub LLM: the professionalize path takes the deterministic split,
// the pricing path takes the generic tiers — the basis is derived server-side
// either way.

Deno.test("REQ-332 m30 e2e: POST /agents/job-details/prices says 'labor; materials as noted' when the customer buys an item", async () => {
  await withServer(async (base) => {
    const sid = await login(base, "+15125552601");
    const res = await fetch(`${base}/agents/job-details/prices`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        raw:
          "Replace the vanity and faucet in the hall bath. They're buying the vanity themselves.",
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.basis, "labor_materials_as_noted");
    assertEquals((body.options as unknown[]).length, 3);
  });
});

Deno.test("REQ-332 m30 e2e: POST /agents/job-details/professionalize keeps 'A + B' as two lines and accepts job context", async () => {
  await withServer(async (base) => {
    const sid = await login(base, "+15125552602");
    const res = await fetch(`${base}/agents/job-details/professionalize`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        text: "4 recesed lights + City of Austin permit",
        context: {
          raw: "4 recesed lights + City of Austin permit, repaint ceiling",
          siblings: ["Repaint ceiling"],
        },
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.lines, ["4 recesed lights", "City of Austin permit"]);
    assertEquals(body.text, "4 recesed lights");

    // The multi-line { details } shape flattens the split too.
    const multi = await fetch(`${base}/agents/job-details/professionalize`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({
        details:
          "4 recesed lights + City of Austin permit\nrepaint the ceiling",
      }),
    });
    assertEquals(multi.status, 200);
    const items = (await multi.json()).items as string[];
    assertEquals(items.length, 3, `three items: ${items}`);
    assert(
      items.some((i) => /City of Austin permit/.test(i)),
      `permit is its own item: ${items}`,
    );
  });
});

// ── REQ-443 — demo-loop cycle 3, m46 over the booted app ───────────────
// "Polish this line?" turned "(trench + patch)" into "(trench" / "Patch)".

Deno.test("REQ-443 m46 e2e: POST /agents/job-details/professionalize keeps a '+' inside parentheses on one line", async () => {
  await withServer(async (base) => {
    const sid = await login(base, "+15125552643");
    const text = "New drain line thru slab to island (trench + patch)";
    const res = await fetch(`${base}/agents/job-details/professionalize`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ text }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.lines, [text]);
    assertEquals(body.text, text);
  });
});

// ── REQ-400 — demo-loop cycle 2 (M5, M21, m32) over the booted app ─────────
// The app's LLM is the StubLLMClient its injector builds; these stories script
// it for their length (the prototype is this test file's own — deno test runs
// each file in its own worker).

async function withScriptedLlm(
  handler: (req: LLMRequest) => LLMResponse,
  fn: () => Promise<void>,
) {
  const original = StubLLMClient.prototype.respond;
  StubLLMClient.prototype.respond = (req: LLMRequest) =>
    Promise.resolve(handler(req));
  try {
    await fn();
  } finally {
    StubLLMClient.prototype.respond = original;
  }
}

const isTranslate = (req: LLMRequest) =>
  // REQ-410 dropped "short" from the prompt (reconciled on demo-fixes)
  /translate (short )?construction scope-of-work/i.test(req.systemPrompt ?? "");

/** TranslateBullets' contract: {"texts": [...]} in, same count out. */
function translated(req: LLMRequest, map: Record<string, string>): LLMResponse {
  const { texts } = JSON.parse(String(req.messages[0].content)) as {
    texts: string[];
  };
  return { text: JSON.stringify({ texts: texts.map((t) => map[t] ?? t) }) };
}

Deno.test("REQ-400 M5 e2e: a Spanish chat quote, locked, carries its job name and summary in English for the customer's document (pair 6)", async () => {
  const EN: Record<string, string> = {
    "Reparación de puerta": "door repair",
    "Reparación de puerta de baño — Maria Lopez":
      "Bathroom door repair — Maria Lopez",
    "Reparación de puerta de baño": "Bathroom door repair",
  };
  await withScriptedLlm(
    (req) => isTranslate(req) ? translated(req, EN) : { text: "{}" },
    () =>
      withServer(async (base) => {
        const sid = await login(base, "+15125554000");
        const h = { ...J, "x-session-id": sid };
        await (await fetch(`${base}/me`, {
          method: "PUT",
          headers: h,
          body: JSON.stringify({ language: "es" }),
        })).body?.cancel();
        // What the chat's create_quote stores: summary, jobName, lines.
        const quote = await (await fetch(`${base}/quotes`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            summary: "Reparación de puerta de baño — Maria Lopez",
            jobName: "Reparación de puerta",
            lineItems: [{
              description: "Reparación de puerta de baño",
              quantity: 1,
              unit: "ea",
              price: 25_000,
            }],
            estimatedTotal: 25_000,
          }),
        })).json();
        const conv = await (await fetch(`${base}/agents/conversations`, {
          method: "POST",
          headers: h,
          body: "{}",
        })).json();
        const lock = await fetch(
          `${base}/agents/conversations/${conv.id}/lock-quote`,
          {
            method: "POST",
            headers: h,
            body: JSON.stringify({ quoteId: quote.id }),
          },
        );
        assertEquals(lock.status, 200);
        await lock.body?.cancel();

        // What /q?lang=en renders from: "Maria Lopez's Door Repair Agreement".
        const pub = await (await fetch(`${base}/quotes/${quote.id}/public`))
          .json();
        assertEquals(pub.jobNameByLang, {
          es: "Reparación de puerta",
          en: "Door Repair",
        });
        assertEquals(
          pub.summaryByLang?.en,
          "Bathroom door repair — Maria Lopez",
        );
        assertEquals(
          pub.lineItems[0].descriptionByLang?.en,
          "Bathroom door repair",
        );
      }),
  );
});

Deno.test("REQ-400 M21 + m32 e2e: POST /agents/job-details/options answers whole-job versions with no customer bullet, even when the model splits the job", async () => {
  const third = (bullets: string[], name: string) => ({
    en: { jobName: name, summary: name, bullets },
  });
  const split = JSON.stringify({
    options: [
      third([
        "Remove old tub/shower combo",
        "Install walk-in shower with curbless entry",
        "Customer: Maria Gutierrez",
      ], "Master Bath Remodel"),
      third(
        ["Linear drain and niche", "Frameless glass panel", "Double vanity"],
        "Master Bath Upgrade",
      ),
      third(
        [
          "Move drain on slab",
          "Exhaust fan and recessed lights",
          "Heated floor",
        ],
        "Complete Bathroom Renovation",
      ),
    ],
  });
  let asked = 0;
  await withScriptedLlm(
    (req) =>
      isTranslate(req) ? translated(req, {}) : (asked++, { text: split }),
    () =>
      withServer(async (base) => {
        const sid = await login(base, "+15125554001");
        // Priya works in English (a new account defaults to Spanish).
        await (await fetch(`${base}/me`, {
          method: "PUT",
          headers: { ...J, "x-session-id": sid },
          body: JSON.stringify({ language: "en" }),
        })).body?.cancel();
        const res = await fetch(`${base}/agents/job-details/options`, {
          method: "POST",
          headers: { ...J, "x-session-id": sid },
          body: JSON.stringify({
            raw:
              "Master bath gut for Maria Gutierrez: tub/shower combo out, curbless shower, " +
              "linear drain + niche, frameless glass, double vanity, move drain on slab, " +
              "fan + recessed lights, heated floor",
          }),
        });
        assertEquals(res.status, 200);
        const body = await res.json() as {
          options: Array<{ jobName: string; bullets: string[] }>;
          degraded: boolean;
        };
        assertEquals(body.degraded, false);
        assertEquals(asked, 2, "the split answer was asked again once");
        for (const o of body.options) {
          const text = o.bullets.join(" | ").toLowerCase();
          for (
            const k of [
              "tub",
              "curbless",
              "niche",
              "glass",
              "vanity",
              "slab",
              "fan",
              "heated",
            ]
          ) {
            assert(text.includes(k), `"${o.jobName}" leaves out ${k}: ${text}`);
          }
          assert(
            !/maria|gutierrez|customer:/i.test(text),
            `a customer bullet: ${text}`,
          );
        }
      }),
  );
});
