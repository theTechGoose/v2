/**
 * REQ-866 AMENDMENT (demo-loop run 11, m2; by hand) — on /welcome at 390×844 the join grace's
 * whole pill (REQ-821: "{name} is guiding you" with End, held out for a few seconds) sat on the
 * step's question and its hint for the whole grace: no `pillSpots` box and no whole-step `pillRows`
 * row was clear, so the pill took "the first row with no control" — the heading's text — while the
 * 73 px band between the skip button and the footer's links was clear. The rows now come every
 * half step, so that band is found: the question is never covered.
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

/** the pill's box, whether it is folded, its words, and what of the page is under it */
const sample = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const under = new Set<string>();
  for (let x = r.left + 4; x < r.right; x += 24) {
    for (let y = r.top + 4; y < r.bottom; y += 12) {
      const e = document.elementsFromPoint(x, y).find((n) =>
        !pill.contains(n) && !n.closest("[data-demo-overlay]")
      );
      if (e) under.add(`${e.localName}.${e.classList[0] ?? ""}`);
    }
  }
  return {
    box: [r.left, r.top, r.width, r.height].map(Math.round),
    tucked: pill.hasAttribute("data-tucked"),
    text: (pill.textContent ?? "").trim().slice(0, 60),
    under: [...under],
  };
};

Deno.test("REQ-866 AMENDMENT (demo-loop run 11, m2): the customer on /welcome step 2 at 390×844 — the join grace's whole pill takes the clear band between the skip button and the footer, never the question and its hint", (t) =>
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
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/welcome`);
      await tab.locator("h1.welcome__question").waitFor({ timeout: 15_000 });
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=es`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      // the join grace: the whole pill from the demo's arrival for a few seconds
      const samples:
        (NonNullable<ReturnType<typeof sample>> & { at: number })[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 4_000) {
        const s = await tab.evaluate(sample);
        if (s) samples.push({ ...s, at: Date.now() - t0 });
        await tab.waitForTimeout(150);
      }
      await tab.screenshot({ path: `${folder}/welcome-pill-390.png` });
      // settled: the pill glides to its spot (REQ-379); what it sits on is judged from 1.5 s on
      const open = samples.filter((s) => !s.tucked && s.at >= 1_500);
      expect(
        open.length >= 5,
        `the whole pill is out through the join grace (${
          JSON.stringify(samples.slice(0, 6))
        })`,
      );
      expect(
        open.some((s) => /guiando/.test(s.text)),
        `it says "{name} te está guiando" (${
          JSON.stringify(open.map((s) => s.text))
        })`,
      );
      const onText = open.filter((s) =>
        s.under.some((u) =>
          /welcome__question|welcome__why|welcome__card/.test(u)
        )
      );
      expect(
        onText.length === 0,
        `m2: never over the question or its hint — ${
          JSON.stringify(onText.slice(0, 3))
        } (all: ${
          JSON.stringify(
            samples.map((s) => [s.at, s.box[1], s.tucked ? "t" : "o"]),
          )
        })`,
      );
      // in the band between "Omitir configuración por ahora" and the footer's links
      const bands = await tab.evaluate(() => {
        const skip = Array.from(document.querySelectorAll("button")).find((b) =>
          /Omitir configuraci/.test(b.textContent ?? "")
        );
        const links = Array.from(document.querySelectorAll("footer a, a"))
          .map((a) => a.getBoundingClientRect())
          .filter((r) => r.top > 600 && r.width > 0);
        return {
          skipBottom: skip ? skip.getBoundingClientRect().bottom : null,
          linksTop: links.length ? Math.min(...links.map((r) => r.top)) : null,
        };
      });
      const last = open[open.length - 1];
      expect(
        bands.skipBottom !== null && bands.linksTop !== null &&
          last.box[1] >= bands.skipBottom - 1 &&
          last.box[1] + last.box[3] <= bands.linksTop + 1,
        `the pill sits in the clear band (${JSON.stringify({ last, bands })})`,
      );
    } finally {
      await userCtx.close();
    }
  }));
