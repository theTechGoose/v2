/**
 * REQ-618 — demo-loop cycle 4, issue p4-p3b (amends REQ-440(c)): during a demo the New invoice
 * sheet's dim ended ~60 px above the window's foot. REQ-440(c) had pulled the sheet's backdrop up
 * by the pill's band (`inset:0 0 var(--demo-pill-h) 0`) to keep its content clear of the pill —
 * but the backdrop IS the dim, so the page behind ("0 cleared") and the pill showed through,
 * undimmed, in that strip.
 *
 * A super admin opens a demo on a contractor; the contractor opens /invoices?new=1 at 1280×720
 * and on a 390×844 phone. On each: the backdrop covers the whole window, the bottom strip beside
 * the pill is the backdrop (never the page behind), and the sheet scrolled to its end still ends
 * above the band, clear of the pill.
 *
 * REQ-781 (demo-loop cycle dv1, d7) AMENDMENT — no band is kept under the page any more: the
 * sheet's backdrop still covers the whole window, and scrolled to its end no field or button of
 * the sheet is under the pill (it docks clear of the sheet or folds to its mini-pill).
 */
import { story } from "#shots";
import type { StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function verify(http: StoryTools["http"], phone: string) {
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
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Evaluated in the customer's page: the sheet's backdrop, the pill, the band, and what is hit in
 * the window's bottom strip beside the pill — the backdrop (dimmed) or the page behind (the bug).
 */
const probe = () => {
  const b = (r: DOMRect) => ({
    left: Math.round(r.left),
    top: Math.round(r.top),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  });
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const form = document.querySelector<HTMLElement>(
    "[data-cy='new-invoice-modal']",
  );
  const backdrop = form?.parentElement ?? null;
  if (!pill || !form || !backdrop) return null;
  const p = pill.getBoundingClientRect();
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const vw = innerWidth;
  const vh = innerHeight;
  const undimmed: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = 2 + ((vw - 4) * i) / 12;
    for (const y of [vh - 2, vh - 20, vh - 40]) {
      if (x >= p.left - 2 && x <= p.right + 2 && y >= p.top - 2) continue;
      const top = document.elementsFromPoint(x, y)
        .find((n) => !n.closest("[data-demo-overlay]") && n !== band);
      if (top && (top === backdrop || backdrop.contains(top))) continue;
      const what = top
        ? `${top.tagName.toLowerCase()} "${
          (top.textContent ?? "").trim().slice(0, 24)
        }"`
        : "nothing";
      undimmed.push(`(${Math.round(x)},${y}) ${what}`);
    }
  }
  // REQ-781 — the sheet's controls under the pill
  const controls = new Set<string>();
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = p.left + 2 + ((p.width - 4) * i) / 10;
      const y = p.top + 2 + ((p.height - 4) * j) / 2;
      const c = document.elementsFromPoint(x, y)
        .find((n) => !n.closest("[data-demo-overlay]"))?.closest(
          'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"]',
        );
      if (c) {
        controls.add(
          `${c.tagName.toLowerCase()} "${
            (c.textContent ?? "").trim().slice(0, 24)
          }"`,
        );
      }
    }
  }
  return {
    controls: [...controls],
    pill: b(p),
    band: band ? b(band.getBoundingClientRect()) : null,
    backdrop: b(backdrop.getBoundingClientRect()),
    form: b(form.getBoundingClientRect()),
    scrollable: backdrop.scrollHeight > backdrop.clientHeight,
    undimmed: [...new Set(undimmed)],
    bandH: getComputedStyle(document.documentElement).getPropertyValue(
      "--demo-pill-h",
    ),
    vw,
    vh,
  };
};
type Probe = NonNullable<ReturnType<typeof probe>>;

Deno.test("REQ-618 (demo-loop cycle 4, p4-p3b): during a demo the New invoice sheet dims the whole window — no undimmed strip under it at 1280 px or 390 px — and, scrolled to its end, no control of it is under the pill (REQ-781: no band)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Ana Torres",
      businessName: "Torres Plumbing",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex from DocuMonster" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });

      // REQ-781 — the pill may be folded to its mini-pill over the sheet: its link state is on it
      const connected = async () =>
        await userPage.locator("[data-cy='demo-pill'][data-status='live']")
          .waitFor({ state: "attached", timeout: 20_000 });

      /** the probe once the pill, the band and the sheet have held still */
      const settled = async (): Promise<Probe> => {
        let last = await userPage.evaluate(probe);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 300));
          const now = await userPage.evaluate(probe);
          const key = (q: typeof now) =>
            q ? JSON.stringify([q.pill, q.band, q.backdrop, q.form]) : "";
          if (now && last && key(now) === key(last)) return now;
          last = now;
        }
        throw new Error(`the sheet never held still: ${JSON.stringify(last)}`);
      };

      const check = async (where: string) => {
        await userPage.goto(`${baseUrl}/invoices?new=1`);
        await connected();
        await userPage.locator("[data-cy='new-invoice-modal']").waitFor({
          timeout: 15_000,
        });

        const opened = await settled();
        await userPage.screenshot({ path: `${folder}/sheet-${where}.png` });
        expect(
          opened.backdrop.top <= 0 && opened.backdrop.left <= 0 &&
            opened.backdrop.right >= opened.vw &&
            opened.backdrop.bottom >= opened.vh,
          `${where}: the sheet's backdrop (its dim) covers the whole window — ${
            JSON.stringify({
              backdrop: opened.backdrop,
              vw: opened.vw,
              vh: opened.vh,
              band: opened.bandH,
            })
          }`,
        );
        expect.eq(
          opened.undimmed.join(" | "),
          "",
          `${where}: the strip at the window's foot, beside the pill, is dimmed — not the page behind`,
        );

        // the sheet scrolled to its end: it still ends above the band, clear of the pill
        await userPage.evaluate(() => {
          const bd = document.querySelector<HTMLElement>(
            "[data-cy='new-invoice-modal']",
          )?.parentElement;
          if (bd) bd.scrollTop = bd.scrollHeight;
        });
        const end = await settled();
        await userPage.screenshot({ path: `${folder}/sheet-${where}-end.png` });
        // REQ-781 — no band: no field or button of the sheet is under the pill
        expect.eq(
          end.controls.join(" | "),
          "",
          `${where}: the sheet, scrolled to its end, has no control under the pill — ${
            JSON.stringify({ form: end.form, pill: end.pill })
          }`,
        );
        expect.eq(
          end.bandH,
          "",
          `${where}: no band is kept under the page`,
        );
        expect.eq(
          end.undimmed.join(" | "),
          "",
          `${where}: the strip at the window's foot is still dimmed once the sheet is scrolled`,
        );
      };

      await connected();
      await check("desktop-1280");
      await userPage.setViewportSize({ width: 390, height: 844 });
      await check("phone-390");
    } finally {
      await userCtx.close();
    }
  }));
