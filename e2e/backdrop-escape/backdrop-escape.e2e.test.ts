/**
 * REQ-732 (demo-loop cycle 5, issue m26) — "fix every issue the demo found":
 * New invoice and Nueva suscripción did not close on Escape ("Escape does not
 * close it; the backdrop kept blocking clicks until I pressed Cancelar"). The
 * shared <Backdrop> (components/Backdrop.tsx, REQ-354) wired the mouse only;
 * Escape was per-dialog and only ClientsPage's New customer had it.
 *
 * In a real browser, in English and Spanish: Escape closes New invoice
 * (/invoices) and New subscription (/field/subscriptions), also with the focus
 * in a field; an Escape that closes the customer search's open list leaves the
 * subscription dialog up; and a deliberate click on the backdrop beside each
 * dialog closes it too.
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
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Escape Story" }),
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
  return auth;
}

/** an island may still be hydrating when its button appears: click until the dialog shows */
async function openBy(
  page: StoryTools["page"],
  opener: string,
  dialog: string,
) {
  const d = page.locator(dialog);
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await d.count()) break;
    try {
      await page.locator(opener).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet
    }
    for (let i = 0; i < 5 && !(await d.count()); i++) {
      await page.waitForTimeout(200);
    }
  }
  await d.waitFor({ timeout: 5_000 });
  // past the backdrop's open grace (REQ-354)
  await page.waitForTimeout(500);
}

async function gone(page: StoryTools["page"], dialog: string, what: string) {
  for (let i = 0; i < 30; i++) {
    if ((await page.locator(dialog).count()) === 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out: ${what}`);
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-732 m26 (${lang}): New invoice closes on Escape — with the focus in a field too — and on a backdrop click`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await page.goto("/invoices");
      const modal = "[data-cy='new-invoice-modal']";

      await openBy(page, "[data-cy='invoice-new']", modal);
      await page.keyboard.press("Escape");
      await gone(page, modal, "New invoice closes on Escape");

      await openBy(page, "[data-cy='invoice-new']", modal);
      await page.locator(`${modal} input`).first().focus();
      await page.keyboard.press("Escape");
      await gone(page, modal, "New invoice closes on Escape from inside a field");

      await openBy(page, "[data-cy='invoice-new']", modal);
      await page.mouse.click(4, 4);
      await gone(page, modal, "New invoice closes on a backdrop click");
      expect(true, "New invoice: Escape and the backdrop both close it");
    }));

  Deno.test(`REQ-732 m26 (${lang}): New subscription closes on Escape and on a backdrop click; an Escape that shuts the customer list keeps it up`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl, lang);
      const c = await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Ana Torres", email: "ana.torres@blackhole.postmarkapp.com" }),
      });
      expect(c.status === 201 || c.status === 200, `customer created (${c.status})`);
      await c.body?.cancel();
      await page.goto("/field/subscriptions");
      const form = "[data-cy='subs-form']";

      await openBy(page, "[data-cy='subs-new']", form);
      await page.keyboard.press("Escape");
      await gone(page, form, "Nueva suscripción closes on Escape");

      // the customer search's list is open: Escape shuts the list, not the dialog
      await openBy(page, "[data-cy='subs-new']", form);
      const box = page.locator("[data-cy='subs-customer'] [data-cy='search-select-input']");
      await box.fill("Ana");
      const option = page.locator("[data-cy='subs-customer'] [data-cy='search-select-option']");
      await option.first().waitFor({ timeout: 5_000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      expect((await option.count()) === 0, "the first Escape shuts the customer list");
      expect((await page.locator(form).count()) === 1, "…and leaves the dialog up");
      await page.keyboard.press("Escape");
      await gone(page, form, "the next Escape closes the dialog");

      await openBy(page, "[data-cy='subs-new']", form);
      await page.mouse.click(4, 4);
      await gone(page, form, "Nueva suscripción closes on a backdrop click");
    }));
}
