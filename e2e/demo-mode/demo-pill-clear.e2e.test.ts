/**
 * REQ-228 — the demo pills never cover the page (demo issue pointer-and-replica-side-effects-m4).
 * A super admin opens a demo on a customer. On the customer's screen — a desktop window, then a
 * phone-size one — no link, button or field of the page has the pill on top of it: the topmost
 * thing at the middle of every visible control is the control, never the pill. On a narrow staff
 * window with a phone-size customer, the stage's pill sits below the frame, not over it.
 */
import { story, type StoryTools } from "#shots";

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

/** the page's visible controls whose middle has the demo pill on top (evaluated in the page) */
const coveredControls = () => {
  const sel =
    'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"]';
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (el.closest("[data-demo-overlay]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (top?.closest("[data-cy='demo-pill']")) {
      out.push(
        `${el.tagName.toLowerCase()} "${
          (el.textContent ?? "").trim().slice(0, 30)
        }" @${Math.round(x)},${Math.round(y)}`,
      );
    }
  }
  return out;
};

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 8_000,
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
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

Deno.test("REQ-228: the customer's demo pill covers no control of the page, on a desktop and on a phone; the stage's pill stays below the frame on a narrow staff window", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 760, height: 700 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      // REQ-294 — a long name, the demo's "Alex from DocuMonster"
      body: JSON.stringify({ language: "en", name: "Hans from DocuMonster" }),
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
      viewport: { width: 1280, height: 800 },
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
      await userPage.reload();
      await userPage.locator("[data-cy='demo-status']").waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 20_000 });

      // 1. desktop: no control of the customer's page sits under the pill
      await until("desktop: the pill covers no control", async () => {
        const c = await userPage.evaluate(coveredControls);
        return c.length ? c.join("; ") : null;
      });

      // 2. phone size: still one line, still covering nothing
      await userPage.setViewportSize({ width: 390, height: 844 });
      await until("phone: the pill covers no control", async () => {
        const c = await userPage.evaluate(coveredControls);
        return c.length ? c.join("; ") : null;
      });
      const pillH = await userPage.locator("[data-cy='demo-pill']").evaluate(
        (el) => el.getBoundingClientRect().height,
      );
      expect(pillH <= 48, `the phone pill is one line (${pillH}px tall)`);

      // REQ-294 (demo m21): tapped, the phone pill says who is guiding — the full name, no
      // "Demo mode" title in the way, and nothing cut to an ellipsis
      await userPage.locator("[data-cy='demo-more']").click();
      await userPage.locator("[data-cy='demo-details']").waitFor({
        timeout: 5_000,
      });
      const details = await userPage.locator("[data-cy='demo-details']")
        .evaluate((el) => {
          const clipped = [el, ...el.querySelectorAll("span")]
            .filter((n) => n.scrollWidth > n.clientWidth + 1)
            .map((n) => (n.textContent ?? "").trim());
          return {
            text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
            clipped,
            width: el.getBoundingClientRect().width,
          };
        });
      expect(
        details.text.includes("Hans from DocuMonster is guiding you"),
        `the opened phone pill names the guide in full — "${details.text}"`,
      );
      expect(
        !details.text.includes("Demo mode"),
        `the phone pill drops the "Demo mode" title — "${details.text}"`,
      );
      expect.eq(
        details.clipped.join(" | "),
        "",
        "nothing in the opened phone pill is cut",
      );
      await userPage.screenshot({ path: `${folder}/phone-pill-open.png` });
      await userPage.locator("[data-cy='demo-more']").click();

      // 3. the stage, narrow, following the phone: the pill is below the frame
      await until("the stage pill is below the frame", async () => {
        const r = await page.evaluate(() => {
          const box = (s: string) =>
            document.querySelector(s)?.getBoundingClientRect() ?? null;
          const frame = box("[data-cy='demo-stage-layer']");
          const pill = box("[data-cy='demo-pill']");
          return frame && pill
            ? {
              frameBottom: frame.bottom,
              frameW: frame.width,
              pillTop: pill.top,
            }
            : null;
        });
        if (!r) return "no frame or pill yet";
        if (r.frameW > 380) {
          return `the frame is not the phone yet (${r.frameW}px)`;
        }
        return r.pillTop >= r.frameBottom
          ? null
          : `pill top ${r.pillTop} above frame bottom ${r.frameBottom}`;
      });

      await page.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "detached",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));
