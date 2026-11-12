/**
 * REQ-379 — demo-loop cycle 2, issues M1 + M6 + M28: the customer's demo pill has ONE home, in a
 * band the page leaves for it.
 *
 * A super admin opens a demo on an onboarded contractor who sits on /customers at 1280×720 (pair
 * 6's screen). On the contractor's screen the pill sits bottom-left, the app's shell ends above it
 * (nothing of the page is under it), a click on its empty area goes through to the page and only
 * its buttons take clicks; every link and button of the sidebar is on top at its own middle, and
 * a real click on Dashboard — after a reload, M28 — goes there. The pill is in the same spot on
 * /customers, /dashboard, after a reload and on /assistant (whose composer and footer end above
 * it), and a live switch to Spanish keeps "Terminar demo" whole. On a 390×844 phone the pill is
 * never wider than 366 px with End inside the screen — after the resize and after a reload — the
 * details opened stay open across a reload, and the drawer's "Log out" is above the pill. The
 * ended notice fits the phone too, and once it is dismissed the page has its band back.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";
import { pillUp } from "../_shared/demo-pill.ts";

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

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 10_000,
) {
  const t0 = Date.now();
  let last: string | null = "never asked";
  while (Date.now() - t0 < timeout) {
    try {
      last = await cond();
      if (last === null) return;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/**
 * The pill (or the ended notice) on the customer's screen and what is around it — evaluated in
 * the page. `under`: the page's elements topmost at a grid of points over the pill (the overlay
 * skipped; the document's root and body are the band, not the page). `throughGap`: a click on the
 * pill's left padding reaches the page, not the pill. `endHit`: End (or ×) is on top at its middle.
 */
const probe = () => {
  const pill = document.querySelector<HTMLElement>(
    "[data-cy='demo-pill'],[data-cy='demo-ended']",
  );
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const under: string[] = [];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = r.left + 2 + ((r.width - 4) * i) / 10;
      const y = r.top + 2 + ((r.height - 4) * j) / 2;
      const el = document.elementsFromPoint(x, y)
        .find((n) => !n.closest("[data-demo-overlay]"));
      if (!el || el === document.body || el === document.documentElement) {
        continue;
      }
      const cls = typeof el.className === "string"
        ? el.className.split(" ")[0]
        : "";
      under.push(
        `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${
          (el.textContent ?? "").trim().slice(0, 24)
        }"`,
      );
    }
  }
  const gap = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
  const end = pill.querySelector<HTMLElement>(
    "[data-cy='demo-end'],[data-cy='demo-ended-dismiss']",
  );
  const e = end?.getBoundingClientRect() ?? null;
  const hit = e
    ? document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2)
    : null;
  const app = document.querySelector(".app")?.getBoundingClientRect() ?? null;
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
    width: Math.round(r.width),
    vw: innerWidth,
    vh: innerHeight,
    under: [...new Set(under)],
    throughGap: !(gap?.closest("[data-demo-overlay]")),
    endHit: Boolean(end && hit && end.contains(hit)),
    endRight: e ? Math.round(e.right) : null,
    endCut: end ? end.scrollWidth > end.clientWidth + 1 : null,
    endText: (end?.textContent ?? "").trim(),
    appBottom: app ? Math.round(app.bottom) : null,
    band: getComputedStyle(document.documentElement).getPropertyValue(
      "--demo-pill-h",
    ).trim(),
    minWidth: pill.style.minWidth,
  };
};
type Probe = NonNullable<ReturnType<typeof probe>>;

/** the sidebar's links and buttons whose own middle has something else on top (in the page) */
const sidebarBlocked = () => {
  const out: string[] = [];
  for (
    const el of Array.from(
      document.querySelectorAll<HTMLElement>(".sb a[href], .sb button"),
    )
  ) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || !el.contains(top)) {
      out.push(
        `${el.tagName.toLowerCase()} "${
          (el.textContent ?? "").trim().slice(0, 24)
        }" under ${top?.tagName.toLowerCase() ?? "nothing"}${
          top?.closest("[data-demo-overlay]") ? " (the demo pill)" : ""
        }`,
      );
    }
  }
  return out;
};

Deno.test("REQ-379: the customer's demo pill has one home in a band the page leaves for it — the same spot on every page and after a reload, nothing of the page under it, only its buttons take a click, the sidebar works; on a phone it fits with End whole and keeps its details open across a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    // onboarded, so the app (not the wizard) is where the demo finds them
    await answerQuestions(http, user.auth, {
      name: "Luis Ortega",
      businessName: "Ortega Handyman Services",
    });
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();
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
      await userPage.goto(`${baseUrl}/customers`);

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
      await userPage.reload();
      // REQ-545 (cycle 4, m2) AMENDMENT — the pill yields to the page: with anything of it under
      // the home (a phone page's cards past the fold) it folds to its edge tab. At the document's
      // end the band is free, and the pill sits home in it — where this story checks it
      const connected = async () => {
        await pillUp(userPage, { live: true });
        await userPage.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*(Connected|Conectado)\s*$/,
        }).waitFor({ timeout: 20_000 });
      };
      await connected();

      /** the pill's box once it has held still for a moment (a dock glides) */
      const settled = async (): Promise<Probe> => {
        let last = await userPage.evaluate(probe);
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 300));
          const now = await userPage.evaluate(probe);
          if (
            now && last && now.left === last.left &&
            now.bottom === last.bottom && now.width === last.width
          ) return now;
          last = now;
        }
        throw new Error(`the pill never held still: ${JSON.stringify(last)}`);
      };
      /** the band is the page's: the pill sits in it, over nothing of the page */
      const inItsBand = (p: Probe, where: string) => {
        expect(
          p.left === 12 && Math.abs(p.vh - 8 - p.bottom) <= 1,
          `${where}: the pill is home, bottom-left in its band — ${
            JSON.stringify({ left: p.left, bottom: p.bottom, vh: p.vh })
          }`,
        );
        expect(
          p.appBottom === null || p.appBottom <= p.top,
          `${where}: the app's shell ends above the pill (shell bottom ${p.appBottom}, pill top ${p.top}, --demo-pill-h "${p.band}")`,
        );
        expect.eq(
          p.under.join(" | "),
          "",
          `${where}: nothing of the page is under the pill`,
        );
      };

      // 1. /customers, desktop: home, the band, click-through, the sidebar
      const onCustomers = await settled();
      await userPage.screenshot({ path: `${folder}/customer-customers.png` });
      inItsBand(onCustomers, "/customers");
      expect(
        onCustomers.throughGap,
        "M28: a click on the pill's empty area reaches the page, not the pill",
      );
      expect(onCustomers.endHit, "End takes its own click");
      expect.eq(
        onCustomers.minWidth,
        "",
        "M6: no measured box is written back as a min-width",
      );
      expect.eq(
        (await userPage.evaluate(sidebarBlocked)).join(" | "),
        "",
        "every link and button of the sidebar is on top at its own middle",
      );

      // 2. M28 — after a reload, the sidebar's Dashboard link works (a real click: Playwright
      //    refuses a click another element would take)
      await userPage.reload();
      await connected();
      await userPage.locator(".sb a.nav-item[href='/dashboard']").click({
        timeout: 5_000,
      });
      await userPage.waitForURL((u) => u.pathname === "/dashboard", {
        timeout: 15_000,
      });
      await connected();
      const onDashboard = await settled();
      await userPage.screenshot({ path: `${folder}/customer-dashboard.png` });
      inItsBand(onDashboard, "/dashboard");
      expect.eq(
        `${onDashboard.left},${onDashboard.bottom}`,
        `${onCustomers.left},${onCustomers.bottom}`,
        "M1: the pill is in the same spot on /dashboard as on /customers",
      );

      // 3. back through the sidebar, then a reload: still the same spot (no per-page memory, no hop)
      await userPage.locator(".sb a.nav-item[href='/customers']").click({
        timeout: 5_000,
      });
      await userPage.waitForURL((u) => u.pathname === "/customers", {
        timeout: 15_000,
      });
      await userPage.reload();
      await connected();
      const reloaded = await settled();
      expect.eq(
        `${reloaded.left},${reloaded.bottom},${reloaded.width}`,
        `${onCustomers.left},${onCustomers.bottom},${onCustomers.width}`,
        "M1: after a reload the pill is the same box in the same spot",
      );

      // 4. a live switch to Spanish (M6, desktop): "Terminar demo" whole, the pill inside the window
      await userPage.locator("[data-cy='topbar-lang-es']").click({
        timeout: 5_000,
      });
      await connected();
      await until("Spanish: End reads Terminar demo, whole", async () => {
        const p = await userPage.evaluate(probe);
        if (!p) return "no pill";
        if (!/Terminar demo/.test(p.endText)) return `End says "${p.endText}"`;
        if (p.endCut) return `End is cut: "${p.endText}"`;
        return p.right <= p.vw - 12
          ? null
          : `the pill runs to ${p.right} of ${p.vw}`;
      });
      inItsBand(await settled(), "/customers in Spanish");
      await userPage.locator("[data-cy='topbar-lang-en']").click({
        timeout: 5_000,
      });
      await connected();

      // 5. /assistant: the composer and the footer end above the pill
      await userPage.goto(`${baseUrl}/assistant`);
      await connected();
      const onAssistant = await settled();
      await userPage.screenshot({ path: `${folder}/customer-assistant.png` });
      inItsBand(onAssistant, "/assistant");
      expect.eq(
        `${onAssistant.left},${onAssistant.bottom}`,
        `${onCustomers.left},${onCustomers.bottom}`,
        "M1: the pill is in the same spot on /assistant",
      );
      const ends = await userPage.evaluate(() => {
        const b = (s: string) =>
          document.querySelector(s)?.getBoundingClientRect().bottom ?? null;
        return {
          composer: b(".composer"),
          footer: b(".site-footer"),
        };
      });
      expect(
        ends.composer !== null && ends.composer <= onAssistant.top &&
          (ends.footer === null || ends.footer <= onAssistant.top),
        `/assistant: the composer (${ends.composer}) and the footer (${ends.footer}) end above the pill (${onAssistant.top})`,
      );

      // 6. a phone: compact, never wider than 366 px, End inside the screen
      await userPage.goto(`${baseUrl}/dashboard`);
      await connected();
      await userPage.setViewportSize({ width: 390, height: 844 });
      const fits = async (where: string) =>
        await until(
          `${where}: the pill fits the 390 px phone with End inside`,
          async () => {
            const p = await userPage.evaluate(probe);
            if (!p) return "no pill";
            if (p.width > 366) {
              return `the pill is ${p.width} px wide (min-width "${p.minWidth}")`;
            }
            if (p.endRight === null || p.endRight > 390 - 12) {
              return `End ends at x=${p.endRight}`;
            }
            return p.endCut ? `End is cut: "${p.endText}"` : null;
          },
        );
      await fits("after the resize");
      await userPage.reload();
      await connected();
      await fits("after a reload on the phone");
      const phone = await settled();
      await userPage.screenshot({ path: `${folder}/customer-phone.png` });
      expect(
        phone.left === 12 && Math.abs(phone.vh - 8 - phone.bottom) <= 1,
        `phone: the pill is home, bottom-left — ${JSON.stringify(phone)}`,
      );
      expect(
        phone.throughGap,
        "phone: the pill's empty area lets a tap through",
      );

      // the details, opened, stay open across a reload (the tab remembers)
      await userPage.locator("[data-cy='demo-more']").click({ timeout: 5_000 });
      await userPage.locator("[data-cy='demo-details']").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await userPage.reload();
      await connected();
      await until(
        "the opened details are still open after a reload",
        async () => {
          const open = await userPage.locator("[data-cy='demo-more']")
            .getAttribute("aria-expanded");
          const shown = await userPage.locator("[data-cy='demo-details']")
            .isVisible();
          return open === "true" && shown
            ? null
            : `aria-expanded ${open}, details visible ${shown}`;
        },
      );
      await userPage.locator("[data-cy='demo-more']").click({ timeout: 5_000 });

      // the drawer: "Log out" at its foot is above the pill, and on top at its middle
      await userPage.locator("[data-cy='mobile-menu']").click({
        timeout: 5_000,
      });
      await userPage.locator(".sb.sb--open").waitFor({ timeout: 5_000 });
      await until("phone: the drawer ends above the pill", async () => {
        const r = await userPage.evaluate(() => {
          const out = document.querySelector<HTMLElement>(
            ".sb .nav-item--logout",
          );
          const pill = document.querySelector("[data-cy='demo-pill']");
          if (!out || !pill) return null;
          const o = out.getBoundingClientRect();
          const p = pill.getBoundingClientRect();
          const hit = document.elementFromPoint(
            o.left + o.width / 2,
            o.top + o.height / 2,
          );
          return {
            logoutBottom: Math.round(o.bottom),
            pillTop: Math.round(p.top),
            onTop: Boolean(hit && out.contains(hit)),
          };
        });
        if (!r) return "no Log out or no pill";
        if (r.logoutBottom > r.pillTop) {
          return `Log out ends at ${r.logoutBottom}, the pill starts at ${r.pillTop}`;
        }
        return r.onTop ? null : "Log out is not on top at its middle";
      });
      await userPage.screenshot({
        path: `${folder}/customer-phone-drawer.png`,
      });
      await userPage.keyboard.press("Escape");
      await userPage.reload();
      await connected();

      // 7. the stage ends it: the notice fits the phone, × inside; dismissed, the band is gone
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-ended']").waitFor({
        timeout: 15_000,
      });
      await until("the ended notice fits the phone with × inside", async () => {
        const p = await userPage.evaluate(probe);
        if (!p) return "no notice";
        if (p.width > 366) return `the notice is ${p.width} px wide`;
        return p.endRight !== null && p.endRight <= 390 - 12
          ? null
          : `× ends at x=${p.endRight}`;
      });
      await userPage.screenshot({ path: `${folder}/customer-phone-ended.png` });
      await userPage.locator("[data-cy='demo-ended-dismiss']").click();
      await until("dismissed: the page has its band back", async () => {
        const left = await userPage.evaluate(() => ({
          band: document.documentElement.style.getPropertyValue(
            "--demo-pill-h",
          ),
          pad: document.body.style.paddingBottom,
        }));
        return left.band === "" && left.pad === ""
          ? null
          : `still reserved: ${JSON.stringify(left)}`;
      });
    } finally {
      await userCtx.close();
    }
  }));
