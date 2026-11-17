/**
 * REQ-866 AMENDMENT 2 (demo-loop run 12, m1; by hand) — the ENGLISH /welcome step 2 at 390×844
 * has a language-hint row the Spanish one does not, and its 43 px compact pill fit no half-step
 * row (REQ-866 AMENDMENT): the join grace's whole pill sat on the hint "At least one language
 * stays on…" for the whole grace, while the 53 px band between Continue (600) and "Skip setup for
 * now" (653) was clear. The pill now reads the page's own clear bands (`pillBands`) when no row
 * is clear — that band is the card's painted foot, the least of the page (no text, no control):
 * it takes that band, and the hint is never covered.
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
    { name: "pm_lang", value: "en", domain, path: "/" },
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

Deno.test("REQ-866 AMENDMENT 2 (demo-loop run 12, m1): the ENGLISH customer on /welcome step 2 at 390×844 — the join grace's whole pill takes the clear band between Continue and 'Skip setup for now', never the language hint", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
    })).body?.cancel();
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex" }),
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
      await tab.goto(`${baseUrl}/welcome?lang=en`);
      await tab.locator("h1.welcome__question").waitFor({ timeout: 15_000 });
      expect(
        /business called/.test(
          await tab.locator("h1.welcome__question").innerText(),
        ),
        "the English step 2",
      );
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=en`);
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
      await tab.screenshot({ path: `${folder}/welcome-en-pill-390.png` });
      // settled: the pill glides to its spot (REQ-379); what it sits on is judged from 1.5 s on
      const open = samples.filter((s) => !s.tucked && s.at >= 1_500);
      expect(
        open.length >= 5,
        `the whole pill is out through the join grace (${
          JSON.stringify(samples.slice(0, 6))
        })`,
      );
      expect(
        open.some((s) => /guiding/.test(s.text)),
        `it says "Alex is guiding you" (${
          JSON.stringify(open.map((s) => s.text))
        })`,
      );
      const onText = open.filter((s) =>
        s.under.some((u) =>
          /welcome__question|welcome__why|welcome__hint|welcome__send-in|welcome__step|welcome__escape|welcome__btn/
            .test(u)
        )
      );
      expect(
        onText.length === 0,
        `m1: never over the question, its hint or the language hint — ${
          JSON.stringify(onText.slice(0, 3))
        } (all: ${
          JSON.stringify(
            samples.map((s) => [s.at, s.box[1], s.tucked ? "t" : "o"]),
          )
        })`,
      );
      // in the band between Continue and "Skip setup for now"
      const bands = await tab.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const cont = btns.find((b) => /^Continue$/.test((b.textContent ?? "").trim()));
        const skip = btns.find((b) => /Skip setup for now/.test(b.textContent ?? ""));
        return {
          contBottom: cont ? cont.getBoundingClientRect().bottom : null,
          skipTop: skip ? skip.getBoundingClientRect().top : null,
        };
      });
      const last = open[open.length - 1];
      expect(
        bands.contBottom !== null && bands.skipTop !== null &&
          last.box[1] >= bands.contBottom - 1 &&
          last.box[1] + last.box[3] <= bands.skipTop + 1,
        `the pill sits in the Continue/Skip band (${
          JSON.stringify({ last, bands })
        })`,
      );
    } finally {
      await userCtx.close();
    }
  }));
