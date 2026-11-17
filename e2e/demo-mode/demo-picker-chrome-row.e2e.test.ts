/**
 * REQ-862 AMENDMENT 6 / REQ-878 AMENDMENT 6 (demo-loop run 12, m3; by hand) — the real stage: the
 * customer at 390×844 on /settings (ES) with a logo really uploaded opens "Reemplazar logo" while
 * the presenter's mouse rests on the dark stage OUTSIDE the frame. REQ-862 AMENDMENT 5 put the
 * chip's words in the chrome row when the frame has no clear spot — but the row was given to the
 * pointer-off hint first ("Tu puntero está fuera de la pantalla de …"), so nothing said she was
 * choosing a file until his mouse entered the frame. The picker's words now come before the hint.
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
  if (!cookie) throw new Error("sign-in: no session cookie");
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}
// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "es", domain, path: "/" },
  ]));
}

/** a 1×1 PNG */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const rowState = () => {
  const q = (s: string) => document.querySelector<HTMLElement>(s);
  const out = q("[data-cy='demo-picker-outside']");
  const off = q("[data-cy='demo-pointer-off']");
  const chip = document.querySelector<HTMLIFrameElement>("iframe")
    ?.contentDocument?.querySelector<HTMLElement>("[data-mirror-picker]");
  return {
    outside: out ? (out.textContent ?? "").trim() : null,
    off: off ? (off.textContent ?? "").trim() : null,
    chipHidden: chip ? /display:none/.test(chip.getAttribute("style") ?? "") : null,
    chipText: chip ? (chip.textContent ?? "").trim() : null,
  };
};

Deno.test("REQ-862 AMENDMENT 6 (demo-loop run 12, m3): his mouse resting beside the frame, she opens 'Reemplazar logo' on the dense 390 px settings page — the chrome row says she is choosing a file (named), the pointer-off hint yields; the hint is back once the chooser closes", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "es", name: "Maria Lopez" }),
    })).body?.cancel();
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "es", name: "Alex" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    await boot.body?.cancel();
    expect.eq(boot.status, 200, "Alex is a super admin");
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const png = await Deno.makeTempFile({ suffix: ".png" });
    await Deno.writeFile(png, PNG);
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/settings?lang=es`);
      // a logo really uploaded: the row with the thumbnail, "Logo cargado" and the hint
      const file = tab.locator("[data-cy='settings-logo-file']");
      await file.waitFor({ state: "attached", timeout: 20_000 });
      await file.setInputFiles(png);
      try {
        await tab.locator("[data-cy='settings-logo-preview']").waitFor({
          timeout: 20_000,
        });
      } catch {
        const why = await tab.evaluate(() => ({
          err: document.querySelector("[data-cy='settings-logo-error']")
            ?.textContent ?? null,
          btn: Array.from(document.querySelectorAll("button")).map((b) =>
            b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""
          ).filter((t) => /logo/i.test(t)),
          url: location.href,
        }));
        throw new Error(`the logo upload left no preview: ${JSON.stringify(why)}`);
      }
      await tab.locator("button[aria-label='Reemplazar logo']").waitFor({
        timeout: 20_000,
      });
      // the demo
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=es`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.locator("iframe").first().waitFor({ timeout: 20_000 });
      await tab.bringToFront();
      await tab.reload();
      await tab.locator("button[aria-label='Reemplazar logo']").waitFor({
        timeout: 20_000,
      });
      await tab.waitForTimeout(2_500);
      // his mouse rests on the dark stage, left of the frame: the pointer-off hint is up
      await page.mouse.move(600, 400);
      await page.mouse.move(30, 400);
      await page.mouse.move(28, 402);
      const t0 = Date.now();
      let st = await page.evaluate(rowState);
      while (Date.now() - t0 < 8_000 && st.off === null) {
        await page.waitForTimeout(200);
        st = await page.evaluate(rowState);
      }
      expect(st.off !== null, `the pointer-off hint is up first (${JSON.stringify(st)})`);
      // she opens the file chooser, for real, and leaves it open
      const chooser = tab.waitForEvent("filechooser");
      await tab.locator("button[aria-label='Reemplazar logo']").click();
      const fc = await chooser;
      const t1 = Date.now();
      const seen: ReturnType<typeof rowState>[] = [];
      let said: ReturnType<typeof rowState> | null = null;
      while (Date.now() - t1 < 6_000) {
        const s = await page.evaluate(rowState);
        seen.push(s);
        if (s.outside !== null) {
          said = s;
          break;
        }
        await page.waitForTimeout(150);
      }
      await page.screenshot({ path: `${folder}/stage-chrome-row.png` });
      expect(
        said !== null,
        `m3: the chrome row says she is choosing a file while his mouse is outside the frame (${
          JSON.stringify(seen.slice(-3))
        })`,
      );
      expect(
        /eligiendo un archivo/.test(said!.outside ?? ""),
        `its words are the picker's (${said!.outside})`,
      );
      expect(
        /Reemplazar logo/.test(said!.outside ?? ""),
        `named after its control (${said!.outside})`,
      );
      expect(
        said!.off === null,
        `the pointer-off hint yields the row (${JSON.stringify(said)})`,
      );
      expect(
        said!.chipHidden === true,
        `the frame's chip is hidden (${JSON.stringify(said)})`,
      );
      // the chooser closes: the row is the hint's again
      await fc.setFiles(png);
      const t2 = Date.now();
      let back = await page.evaluate(rowState);
      while (Date.now() - t2 < 6_000 && (back.outside !== null || back.off === null)) {
        await page.waitForTimeout(150);
        back = await page.evaluate(rowState);
      }
      expect(
        back.outside === null && back.off !== null,
        `after the chooser: no picker words, the pointer-off hint back (${
          JSON.stringify(back)
        })`,
      );
    } finally {
      await Deno.remove(png).catch(() => {});
      await userCtx.close();
    }
  }));
