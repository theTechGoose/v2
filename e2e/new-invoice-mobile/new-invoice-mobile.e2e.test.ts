/**
 * REQ-482 (demo-loop cycle 3, issue M39) — the New invoice sheet overflowed a
 * 390 px phone: the paired fields (Name/Business, Email/Phone, Service
 * from/to, Discount/reason, Terms/Due) sat in `grid-template-columns:1fr 1fr`,
 * whose bare `1fr` tracks never shrink below their inputs' intrinsic width, so
 * the right column ran from x≈271 to x≈488 on a 390 px screen. The line-item
 * row (`1fr 64px 76px 110px 28px`) added ~300 px of fixed tracks on top.
 *
 * On a 390 px phone, in English and Spanish, with a line item added, every
 * input, select and textarea in the sheet must lie inside the viewport, and the
 * sheet itself must not be wider than the screen.
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal).
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: lang, name: "Mobile Invoice Story" }),
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

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-482 M39: on a 390px phone (${lang}) every field of the New invoice sheet, line items included, stays inside the screen`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(http, page, baseUrl, lang);
      await page.goto("/invoices?new=1");
      const modal = page.locator("[data-cy='new-invoice-modal']");
      await modal.waitFor({ timeout: 15_000 });
      const add = page.locator("[data-cy='new-invoice-line-add']");
      const row = page.locator("[data-cy='new-invoice-line-0']");
      // click until the island has hydrated and the first line row exists
      for (let i = 0; i < 30 && (await row.count()) === 0; i++) {
        await add.click();
        await page.waitForTimeout(300);
      }
      await row.waitFor({ timeout: 5_000 });

      const report = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sheet = document.querySelector(
          "[data-cy='new-invoice-modal']",
        ) as HTMLElement;
        const out: string[] = [];
        for (
          const el of sheet.querySelectorAll<HTMLElement>(
            "input, select, textarea",
          )
        ) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue; // hidden
          if (r.left < 0 || r.right > vw + 0.5) {
            out.push(
              `${el.dataset.cy ?? el.tagName} x${Math.round(r.left)}→${
                Math.round(r.right)
              }`,
            );
          }
        }
        const s = sheet.getBoundingClientRect();
        return {
          vw,
          sheet: `${Math.round(s.left)}→${Math.round(s.right)}`,
          sheetFits: s.left >= 0 && s.right <= vw + 0.5,
          out,
        };
      });
      expect.eq(report.vw, 390, "the phone viewport is 390px wide");
      expect(
        report.sheetFits,
        `the sheet fits the screen (x${report.sheet} on ${report.vw})`,
      );
      expect.eq(
        report.out.join(", "),
        "",
        `no field runs past the right edge of a ${report.vw}px screen`,
      );
    }));
}
