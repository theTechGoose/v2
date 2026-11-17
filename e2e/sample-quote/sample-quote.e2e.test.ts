/**
 * REQ-256 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue onboarding-dashboard-settings-p2 (pair 6): the onboarding sample
 * opened as "Q-001 · Versión 1 · Enviada", "Paver Patio Installation" in
 * English on the Spanish page, and "PARA —".
 *
 * A plumber's account makes its sample the way the wizard does
 * (POST /api/agents/conversations/sample-quote) and opens /q/<id> in Spanish,
 * then toggles to English.
 *
 * Copy pinned (lang/{en,es}.json): ensureSampleQuote.plumbing.jobName,
 * quoteDoc.sampleCustomer, quoteDoc.sampleHeadline.
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };
const en = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/en.json", import.meta.url)),
) as Record<string, string>;
const es = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/es.json", import.meta.url)),
) as Record<string, string>;

async function seedSample(http: StoryTools["http"]): Promise<string> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const auth = { ...JSON_HEADERS, cookie };
  const send = async (path: string, payload: unknown, method = "POST") =>
    await (await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    })).json();
  await send("/api/me", { name: "Rosa Rivera", language: "es" }, "PUT");
  await send(
    "/api/profile/identity",
    { businessName: "Plomería Rivera" },
    "PUT",
  );
  const made = await send("/api/agents/conversations/sample-quote", {});
  return made.quoteId as string;
}

const bodyText = (page: StoryTools["page"]) => page.locator("body").innerText();

Deno.test("REQ-256: a plumber's sample opens in Spanish as a sample — Spanish plumbing job, 'Tu cliente', no Q-001, not sent", (t) =>
  story(t, async ({ page, expect, http }) => {
    const quoteId = await seedSample(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quoteId}?lang=es`);
    await expect.see(es["ensureSampleQuote.plumbing.jobName"], {
      timeout: 15_000,
    });
    await expect.see(es["quoteDoc.sampleCustomer"]);
    await expect.see(es["quoteDoc.sampleHeadline"]);
    await expect.see(es["ensureSampleQuote.plumbing.materials"]);
    const text = await bodyText(page);
    expect(
      !/Paver|adoquines/i.test(text),
      "no paver patio on a plumber's sample",
    );
    expect(
      !text.includes(en["ensureSampleQuote.plumbing.jobName"]),
      "no English job name on the Spanish page",
    );
    expect(
      !text.includes(en["ensureSampleQuote.plumbing.materials"]),
      "no English line item on the Spanish page",
    );
    expect(!/Q-0*1\b/.test(text), "the sample took no Q- number");
    expect(!/Enviada/.test(text), "the sample is not marked sent");
    expect(!/PARA\s*\n?\s*—/i.test(text), "the To card is not empty");
  }));

Deno.test("REQ-256: the EN toggle flips the sample's content too, not only the chrome", (t) =>
  story(t, async ({ page, expect, http }) => {
    const quoteId = await seedSample(http);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quoteId}?lang=es`);
    await expect.see(es["ensureSampleQuote.plumbing.jobName"], {
      timeout: 15_000,
    });
    await page.locator("button[data-contract-lang=en]").click();
    await expect.see(en["ensureSampleQuote.plumbing.jobName"]);
    await expect.see(en["ensureSampleQuote.plumbing.labor"]);
    await expect.see(en["quoteDoc.sampleCustomer"]);
    const text = await bodyText(page);
    expect(
      !text.includes(es["ensureSampleQuote.plumbing.jobName"]),
      "no Spanish job name left",
    );
  }));
