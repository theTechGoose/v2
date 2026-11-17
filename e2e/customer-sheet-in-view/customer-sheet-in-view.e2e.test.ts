import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Delete Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

/** REQ-807 (hotfix 2026-11-13): "Open card" on the last card of a scrolled /customers page — the
 *  sheet opens over the screen where the person is. Before: motion.css's finished entrance left a
 *  transform on the content pane, which made it the containing block for the sheet's
 *  position:fixed backdrop, so the sheet sat at the top of the pane (~5000 px above the viewport)
 *  and was found only after scrolling all the way up. */
Deno.test("REQ-807: Open card at the bottom of /customers opens the sheet in view — the backdrop covers the viewport and the pane does not scroll", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    for (let i = 0; i < 24; i++) {
      await (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: `Zz Customer ${String(i).padStart(2, "0")}`,
          phoneNumber: `+1512${digits()}`,
        }),
      })).json();
    }
    await page.setViewportSize({ width: 1306, height: 744 });
    await page.goto("/customers");
    await page.locator(".ccard2").first().waitFor({ timeout: 20_000 });
    const last = page.locator(".ccard2").last();
    await last.scrollIntoViewIfNeeded();
    // let the entrance animation finish — the bug is its leftover
    await page.waitForTimeout(800);
    const paneTop = () =>
      page.evaluate(() =>
        (document.querySelector(".content") as HTMLElement).scrollTop
      );
    const before = await paneTop();
    expect(before > 1000, `the pane is scrolled down (scrollTop ${before})`);

    await last.locator(".ccard2__body").click();
    await last.locator("[data-cy='ccard2-open']").waitFor({ timeout: 10_000 });
    await last.locator("[data-cy='ccard2-open']").click();
    const sheet = page.locator("[data-cy='client-sheet']");
    await sheet.waitFor({ state: "attached", timeout: 10_000 });
    const geo = await page.evaluate(() => {
      const s = document.querySelector("[data-cy='client-sheet']")!;
      const bd = s.parentElement!.getBoundingClientRect();
      const r = s.getBoundingClientRect();
      return {
        bdTop: Math.round(bd.top),
        bdH: Math.round(bd.height),
        sheetTop: Math.round(r.top),
        vh: innerHeight,
      };
    });
    expect.eq(
      geo.bdTop,
      0,
      `the backdrop starts at the top of the viewport (${JSON.stringify(geo)})`,
    );
    expect.eq(geo.bdH, geo.vh, "the backdrop is the viewport's height");
    expect(
      geo.sheetTop >= 0 && geo.sheetTop < geo.vh,
      `the sheet is on screen (${JSON.stringify(geo)})`,
    );
    expect(await sheet.isVisible(), "the sheet is visible");
    await expect.see("Zz Customer 23");
    expect.eq(await paneTop(), before, "the pane did not scroll");
  }));
