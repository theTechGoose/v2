/**
 * REQ-619 — demo-loop cycle 4, issue p4-p3d: "Every page header reads 'Hey, Deb 👋' with no page
 * name, so on a phone I can't tell where I am". On a phone (the sidebar shut in its drawer) the
 * topbar heading names the page — Invoices, Quotes, Customers, Payments, Settings, the field pages —
 * in the live language; only /dashboard greets "Hey, Deb 👋".
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-619 (demo p4-p3d): on a phone every app page's topbar names the page; only /dashboard greets", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
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
      throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
    }
    const auth = { ...JSON_HEADERS, cookie };
    // past onboarding (REQ-091), or /dashboard sends the account back to the wizard
    await answerQuestions(http, auth, { name: "Deb Hale" });
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();

    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));
    await page.setViewportSize({ width: 390, height: 844 });

    const heading = async (path: string) => {
      await page.goto(path);
      const h = page.locator(".topbar__greet-name");
      await h.waitFor({ timeout: 15_000 });
      return ((await h.textContent()) ?? "").trim();
    };

    const pages: Array<[string, string]> = [
      ["/invoices", "Invoices"],
      // REQ-746 (cycle 5, c1-p15-18): the quotes page holds the agreements too
      ["/quotes", "Quotes & agreements"],
      ["/customers", "Customers"],
      ["/payments", "Payments"],
      ["/settings", "Settings"],
      ["/field/tasks", "Tasks"],
    ];
    for (const [path, title] of pages) {
      const text = await heading(path);
      expect.eq(text, title, `${path}: the topbar heading names the page`);
    }
    expect.eq(
      await heading("/dashboard"),
      "Hey, Deb 👋",
      "/dashboard keeps the greeting",
    );

    // the heading follows the live language: the topbar's ES switch renames the page at once
    await heading("/invoices");
    const title = page.locator(".topbar__greet-name");
    await clickUntil(
      page,
      '[data-cy="topbar-lang-es"]',
      async () => ((await title.textContent()) ?? "").trim() === "Facturas",
    );
    expect.eq(
      ((await page.locator(".topbar__greet-name").textContent()) ?? "").trim(),
      "Facturas",
      "/invoices in Spanish: the heading is the es nav label",
    );
  }));
