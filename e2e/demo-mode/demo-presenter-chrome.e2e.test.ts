/**
 * REQ-855 (demo-loop cycle dm3, issues m5 + m6 + rc-17) — while Hans (English) guides Maria
 * (Spanish), his own chrome off the stage is his:
 *
 *   - m6 (fleet-0): on her pages his demo pill read "Modo demo · Guiando a Maria Lopez · Volver a
 *     la demo" — her language — next to an English bar, and its Back to the demo carried ?lang=es
 *     into the stage (rc-17: a Spanish stage, End → /admin?lang=es).
 *   - m5 (fleet-0, fleet-2): the red "Impersonating … Return to your account" bar sat beside that
 *     pill (and over /admin's guide gate), and there was no EN/ES control of his while guiding.
 *
 * The tester's path: /admin?lang=en → Demo → the stage → /dashboard (her /welcome).
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

/** the browser carries Hans's session only — no pm_lang: his language is his profile's */
// deno-lint-ignore no-explicit-any
async function useSession(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies(
    [...hosts].map((domain) => ({ name, value, domain, path: "/" })),
  );
}

async function profile(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  language: "en" | "es",
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name }),
  })).body?.cancel();
}

Deno.test("REQ-855 (cycle dm3, m5 + m6 + rc-17): Hans (en) guiding Maria (es) — on her page no red bar and an English pill (End demo, EN | ES) whose Back to the demo opens /demo/stage?lang=en; on /admin's gate no red bar and an EN | ES switch the hops carry; End from her page lands on an English /admin", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await profile(http, user.auth, "Maria Lopez", "es");
    const hans = await verify(http, hansPhone);
    await profile(http, hans.auth, "Hans", "en");
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: hansPhone, token }),
    });
    expect.eq(boot.status, 200, `Hans is a super admin (${await boot.text()})`);

    await useSession(page.context(), baseUrl, hans.cookie);
    await page.goto(`${baseUrl}/admin?lang=en`);
    await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });
    // unframed (it navigates to the stage — see Back to the demo below)
    const demoBtn = await page.locator("[data-cy='adm-demo']").first()
      .boundingBox();
    if (!demoBtn) throw new Error("no Demo button on /admin");
    await page.mouse.click(
      demoBtn.x + demoBtn.width / 2,
      demoBtn.y + demoBtn.height / 2,
    );
    await page.waitForURL((u) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });
    await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });

    // the tester's path: from the stage to /dashboard — her page (her /welcome), in her Spanish
    await page.goto(`${baseUrl}/dashboard`);
    await page.locator("[data-cy='demo-rejoin']").waitFor({ timeout: 20_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(2_000); // every island's whoami / active answered
    expect.eq(
      await page.locator("[data-cy='imp-banner']").count(),
      0,
      "m5: no red impersonation bar beside the presenter's pill",
    );
    const pill = await page.locator("[data-cy='demo-pill']").innerText();
    expect(
      pill.includes("Demo mode") && pill.includes("Guiding Maria Lopez") &&
        pill.includes("Back to the demo"),
      `m6: the pill speaks Hans's English on her page ("${pill}")`,
    );
    expect(
      !/Modo demo|Guiando|Volver a la demo/.test(pill),
      `m6: no Spanish in Hans's pill ("${pill}")`,
    );
    expect(
      pill.includes("End demo"),
      `m5: the way out is on the pill ("${pill}")`,
    );
    expect.eq(
      await page.locator("[data-cy='demo-lang-en']").getAttribute(
        "aria-current",
      ),
      "true",
      "m5: the pill's EN | ES switch says EN",
    );

    // rc-17: the way back carries HIS language, not hers
    // a real mouse click, not framed: the runner's frame right after a click that navigates to the
    // stage can stall 90 s on this host (REQ-823/838's evidence) — the URL below says what it did
    const back = await page.locator("[data-cy='demo-rejoin']").boundingBox();
    if (!back) throw new Error("no 'Back to the demo' on her page");
    await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
    await page.waitForURL((u) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });
    expect.eq(
      new URL(page.url()).searchParams.get("lang"),
      "en",
      "rc-17: Back to the demo opens /demo/stage?lang=en",
    );
    await page.waitForLoadState("load");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "rc-17: the stage is English",
    );

    // /admin while guiding: the gate, no red bar, and a real EN | ES switch the hops carry
    await page.goto(`${baseUrl}/admin`);
    await page.locator("[data-cy='admin-gate']").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(2_000);
    expect.eq(
      await page.locator("[data-cy='imp-banner']").count(),
      0,
      "m5: no red bar over /admin's guide gate",
    );
    await page.locator("[data-cy='public-lang-toggle'] a[hreflang='es']")
      .click();
    await page.waitForURL((u) => u.searchParams.get("lang") === "es", {
      timeout: 15_000,
    });
    await page.locator("[data-cy='admin-gate']").waitFor({ timeout: 15_000 });
    const gateEs = await page.locator("[data-cy='admin-gate']").innerText();
    expect(
      gateEs.includes("Estás guiando a Maria Lopez en este navegador"),
      `m5: ES on the gate turns it Spanish ("${gateEs.slice(0, 200)}")`,
    );
    // REQ-893 (dm6, p10) — the customer's name is on one line of the heading, in its own span
    const nameLines = await page.evaluate(() => {
      const el = document.querySelector("[data-cy='admin-gate-name']");
      if (!el) return { lines: 0, text: "" };
      const rs = el.getClientRects();
      const tops = new Set([...rs].map((r) => Math.round(r.top)));
      return { lines: tops.size, text: el.textContent ?? "" };
    });
    expect.eq(
      nameLines.text.trim(),
      "Maria Lopez",
      "p10: the name span holds the name",
    );
    expect.eq(
      nameLines.lines,
      1,
      "p10: the name is on one line, never Maria / Lopez",
    );
    expect.eq(
      await page.locator("[data-cy='admin-gate-back']").getAttribute("href"),
      "/demo/stage?lang=es",
      "rc-17: the gate's Back to the demo carries the pick",
    );
    await page.locator("[data-cy='public-lang-toggle'] a[hreflang='en']")
      .click();
    await page.waitForURL((u) => u.searchParams.get("lang") === "en", {
      timeout: 15_000,
    });
    await page.locator("[data-cy='admin-gate']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='admin-gate-back']").getAttribute("href"),
      "/demo/stage?lang=en",
      "rc-17: EN again — Back to the demo carries en",
    );

    // m5: End from her page — the pill asks, the demo ends, Hans is himself on an English /admin
    await page.goto(`${baseUrl}/dashboard`);
    await page.locator("[data-cy='demo-end']").waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='demo-end']").click();
    const yes = page.locator("[data-cy='demo-end-confirm']");
    await yes.waitFor({ timeout: 5_000 });
    // REQ-816/835 — the asking pill glides (PILL_MOVE_MS) to a place inside the window
    await page.waitForTimeout(800);
    const yesBox = await yes.boundingBox();
    expect(
      yesBox !== null && yesBox.x >= 0 && yesBox.x + yesBox.width <= 1280 &&
        yesBox.y >= 0 && yesBox.y + yesBox.height <= 800,
      `End's question rests inside the window (${JSON.stringify(yesBox)})`,
    );
    // unframed for the same reason: Yes navigates to /admin
    await page.mouse.click(
      yesBox!.x + yesBox!.width / 2,
      yesBox!.y + yesBox!.height / 2,
    );
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 20_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(1_500);
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "m5: /admin after End is English",
    );
    const body = await page.locator("body").innerText();
    expect(
      body.includes("You ended the demo"),
      `m5: /admin says "You ended the demo" (${body.slice(0, 300)})`,
    );
    expect.eq(
      await page.locator("[data-cy='admin-gate']").count(),
      0,
      "m5: the account came back — the console, not the gate",
    );
  }));
