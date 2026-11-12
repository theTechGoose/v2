/**
 * REQ-408 — demo-loop cycle 2, issues p13-a and p13-d, in a browser.
 *
 *   p13-a  on a fresh account /payments (Spanish) painted the in-transit KPI
 *          in the pink alert accent reading "$0 · 0 en camino". Now: a plain
 *          white cell reading "—" / "Nada en camino".
 *   p13-d  on a phone (390×844) the /invoices intro paragraph touched
 *          "+ New invoice". Now: at least 10 px between them.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: lang, name: "Finance Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
}

Deno.test("REQ-408 (p13-a): with nothing in transit, /payments shows a plain '—' cell, not the pink accent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, "es");
    await page.goto("/payments");
    const cell = page.locator("[data-cy='payments-kpi-transit']");
    await cell.waitFor({ timeout: 15_000 });
    const seen = await cell.evaluate((el) => ({
      cls: el.className,
      bg: getComputedStyle(el).backgroundImage,
      val: el.querySelector(".qkpi__val")?.textContent?.trim(),
      sub: el.querySelector(".qkpi__sub")?.textContent?.trim(),
    }));
    expect(
      !/qkpi__cell--accent/.test(seen.cls),
      `no accent class (${seen.cls})`,
    );
    expect.eq(seen.bg, "none", "no pink gradient");
    expect.eq(seen.val, "—", "the value");
    expect.eq(seen.sub, "Nada en camino", "the caption");
  }));

Deno.test("REQ-408 (p13-d): on a phone the /invoices intro does not touch '+ New invoice'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(http, page, baseUrl, "en");
    await page.goto("/invoices");
    const cta = page.locator("[data-cy='invoice-new']");
    await cta.waitFor({ timeout: 15_000 });
    const gap = await cta.evaluate((btn) => {
      const row = btn.closest(".qph__cta-row")!;
      const intro = row.previousElementSibling!;
      return btn.getBoundingClientRect().top -
        intro.getBoundingClientRect().bottom;
    });
    expect(gap >= 10, `intro → button gap is ${gap}px`);
  }));
