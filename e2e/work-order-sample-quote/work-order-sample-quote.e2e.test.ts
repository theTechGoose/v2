/**
 * REQ-1058 (LOOP-007 cycle 2, q2-47) — the New work order Quote picker never offers the
 * onboarding sample quote. Amends REQ-210; follows REQ-360 ("the onboarding sample quote never
 * passes for real data") and REQ-474 (the New invoice quote picker drops `isSample`).
 *
 * QA, /work-orders → New work order → Quote: the options were "No quote" and
 * "#43DE4E2D · Paver Patio Installation" — the sample, unbadged, under its raw hex id.
 *
 * A new owner gets the sample the way the onboarding wizard makes it
 * (POST /api/agents/conversations/sample-quote) plus one real quote, opens New work order and,
 * once the real quote is listed (so the lists have loaded), finds no sample in the Quote
 * picker and no "#XXXXXXXX" hex label.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function ownerWithSample(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const send = async (path: string, payload: unknown, method = "POST") =>
    await (await http(path, { method, headers: auth, body: JSON.stringify(payload) })).json();
  await send("/api/me", { name: "Pat Rivera", language: "en" }, "PUT");
  await send("/api/profile/identity", { businessName: "Rivera Hardscapes" }, "PUT");
  const sample = await send("/api/agents/conversations/sample-quote", {});
  const job = `Retaining wall ${digits()}`;
  const real = await send("/api/quotes", {
    summary: job,
    jobName: job,
    lineItems: [{ description: job, quantity: 1, unit: "job", price: 180000 }],
    estimatedTotal: 180000,
  });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]),
  );
  return { sampleId: sample.quoteId as string, realId: real.id as string, job };
}

Deno.test("REQ-1058 (LOOP-007 q2-47): New work order's Quote picker does not offer the onboarding sample, and no option is a raw '#XXXXXXXX' id", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { sampleId, realId, job } = await ownerWithSample(http, page, baseUrl);
    expect(!!sampleId && !!realId, `the sample (${sampleId}) and a real quote (${realId}) exist`);

    await page.goto("/work-orders");
    const modal = page.locator("[data-cy='wo-new-modal']");
    for (let i = 0; i < 10 && !(await modal.isVisible()); i++) {
      await page.locator("[data-cy='wo-new']").click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await modal.waitFor({ timeout: 15_000 });
    const picker = page.locator("[data-cy='wo-new-quote']");
    // the lists have loaded once the real quote is an option
    await picker.locator(`option[value='${realId}']`).waitFor({ state: "attached", timeout: 15_000 });

    // one read of every option, so the assertions see one render
    const options = await picker.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent ?? "" }))
    );
    const values = options.map((o) => o.value);
    const texts = options.map((o) => o.text.trim());
    expect(texts.some((x) => x.includes(job)), `the real quote is offered (${JSON.stringify(texts)})`);
    expect(!values.includes(sampleId), `the sample quote is not offered (${JSON.stringify(texts)})`);
    expect(
      !texts.some((x) => /#[0-9A-F]{8}\b/.test(x)),
      `no option is labelled with a raw hex id (${JSON.stringify(texts)})`,
    );
  }));
