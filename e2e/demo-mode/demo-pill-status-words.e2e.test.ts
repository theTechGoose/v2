/**
 * REQ-838 — demo-loop cycle dm2 (run r9c47ba57), issues m5, p4 and p8, end to end in two real
 * browsers (the customer's and the presenter's).
 *
 *   1. m5: the customer changes page from OUTSIDE the app in her only tab — a URL in the address
 *      bar (`page.goto`), then the browser's reload button (`page.reload`): neither fires a
 *      Navigation API `navigate`, so the page says "closing". The stage says "Loading their next
 *      page…" for it — never "Waiting for {name}'s app…" at once, nor before SILENT_GRACE_MS
 *      (a next page slower than that on a loaded host may still get it after the hold, as a closed
 *      tab does) — and its copy of her pill speaks HER language the whole time: the presenter's
 *      stage is Spanish, her pill English — never "Conectando…" beside "Demo mode".
 *   2. p4: the customer signs out (her only tab): the stage says "Ana Torres signed out" and draws
 *      nothing of a screen she no longer has — no copy of her pill, no "move it to show it"
 *      advice, and none of his pointer when he moves over the frame.
 *   3. p8: the presenter leaves the stage (to /admin): the customer's pill never says
 *      "Connecting…" under "Hans is guiding you" — it goes from Connected to "Hans stepped away",
 *      "The demo is still open". He comes back: Connected, "Hans is guiding you".
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** past SILENT_GRACE_MS (2 s): a "waiting" that the hold only put off would have come by then */
const PAST_SILENT_MS = 3_000;
/** SILENT_GRACE_MS (shared/demo-mode/protocol.ts): how long the stage holds a closing page */
const SILENT_GRACE_MS = 2_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Lang = "en" | "es";

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

async function useCookie(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  baseUrl: string,
  cookie: string,
  lang: Lang,
) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
  ]));
}

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch {
      // mid-navigation; ask again
    }
    await sleep(100);
  }
  throw new Error(`timed out: ${what}`);
}

/** a customer (Ana Torres) and a super admin (Hans), signed up fresh, each in their language */
async function people(
  http: StoryTools["http"],
  langs: { user: Lang; admin: Lang },
) {
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: langs.user, name: "Ana Torres" }),
  })).body?.cancel();
  // past onboarding (REQ-091): the app's pages, with the sidebar's Log out, are hers
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: langs.admin, name: "Hans" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  return { user, admin, userPhone, adminPhone };
}

// deno-lint-ignore no-explicit-any
type Page = any;

/** on /admin: find the customer and click Demo; the page lands on the stage */
async function openDemo(pg: Page, baseUrl: string, userPhone: string) {
  await pg.goto(`${baseUrl}/admin`);
  await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await pg.locator("[data-cy='adm-search']").click();
  const demo = pg.locator("[data-cy='adm-demo']").first();
  await demo.waitFor({ timeout: 15_000 });
  // a real mouse click (the button is drawn by the hydrated search results): the runner's frame
  // taken right after a click that navigates to /demo/stage can stall 90 s on this host (REQ-823's
  // evidence) — the stage's URL and pill below say what it did
  const b = await demo.boundingBox();
  if (!b) throw new Error("no Demo button on /admin");
  await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
}

const text = (pg: Page, sel: string) =>
  pg.locator(sel).first().innerText().then((s: string) => s.trim());
const statusOf = (pg: Page) => text(pg, "[data-cy='demo-status']");
const pathOf = (pg: Page) =>
  pg.locator("[data-cy='demo-frame']").getAttribute("data-path") as Promise<
    string | null
  >;
const count = (pg: Page, sel: string) =>
  pg.locator(sel).count() as Promise<number>;

/** the stage and the customer's one tab (`size`), on /dashboard, Live, her routes warmed */
async function demoOn(
  page: Page,
  http: StoryTools["http"],
  baseUrl: string,
  langs: { user: Lang; admin: Lang },
  size: { width: number; height: number },
  live: string,
) {
  const who = await people(http, langs);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport: size });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, who.user.cookie, langs.user);
  // the dev server compiles a route on its first visit (seconds): the pages the story moves to
  // are visited once before the demo, as a built deploy serves them at once
  for (const p of ["/customers", "/dashboard"]) {
    await tab.goto(`${baseUrl}${p}`);
  }
  await useCookie(page.context(), baseUrl, who.admin.cookie, langs.admin);
  await openDemo(page, baseUrl, who.userPhone);
  await tab.reload();
  await pillUp(tab, { live: true });
  await until(
    `the stage is ${live} on her screen`,
    async () => (await statusOf(page)) === live,
    30_000,
  );
  return { ...who, userCtx, tab };
}

/** what the stage shows, every 25 ms, each change kept: its status, the waiting banner, and its
 *  copy of the customer's pill (title, status) */
interface Seen {
  status: string;
  banner: string;
  title: string;
  ghost: string;
  /** REQ-896 (p7) — "drawn" while a ghost of her pill is on the stage */
  pill: string;
  /** when it was first seen (ms, the stage page's clock) */
  at: number;
}
const record = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmSeen: unknown[];
      __pmTimer?: ReturnType<typeof setInterval>;
    };
    clearInterval(w.__pmTimer);
    w.__pmSeen = [];
    let last = "";
    const read = (sel: string) =>
      document.querySelector(sel)?.textContent?.trim() ?? "";
    w.__pmTimer = setInterval(() => {
      const s = {
        status: read("[data-cy='demo-status']"),
        banner: read("[data-cy='demo-waiting']"),
        title: read("[data-cy='demo-pill-ghost-title']"),
        ghost: read("[data-cy='demo-pill-ghost-status']"),
        // REQ-896 (p7) — is a ghost of her pill drawn at all
        pill: document.querySelector("[data-cy='demo-pill-ghost']")
          ? "drawn"
          : "",
      };
      const k = JSON.stringify(s);
      if (k !== last) {
        last = k;
        w.__pmSeen.push({ ...s, at: Math.round(performance.now()) });
      }
    }, 25);
  });
const recorded = (pg: Page) =>
  pg.evaluate(() =>
    (globalThis as unknown as { __pmSeen: unknown[] }).__pmSeen
  ) as Promise<Seen[]>;

Deno.test("REQ-838 m5 (demo-loop cycle dm2) + REQ-896 (dm6, p1): the customer's address-bar navigation and reload in her only tab (a page says 'closing' for both) — the stage says 'Un momento…', never 'Waiting for …' at once, and its copy of her English pill never says the Spanish stage's 'Conectando…'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // fleet-1's pair: the customer English, the presenter Spanish (his stage speaks Spanish)
    const { userCtx, tab } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "es" },
      { width: 1000, height: 760 },
      "En vivo",
    );
    try {
      await until(
        "the stage draws her pill's copy, in her words",
        async () =>
          (await text(page, "[data-cy='demo-pill-ghost-status']")) ===
            "Connected",
        15_000,
      );
      await record(page);
      // 1. a URL typed in the address bar: the page says "closing"
      await tab.goto(`${baseUrl}/customers`);
      await pillUp(tab);
      await until(
        "the stage shows /customers, Live",
        async () =>
          (await pathOf(page)) === "/customers" &&
          (await statusOf(page)) === "En vivo",
        20_000,
      );
      await sleep(PAST_SILENT_MS);
      // 2. the browser's reload button: "closing" too
      await tab.reload();
      await pillUp(tab);
      await until(
        "the stage is Live on her reloaded /customers",
        async () =>
          (await pathOf(page)) === "/customers" &&
          (await statusOf(page)) === "En vivo",
        20_000,
      );
      await sleep(PAST_SILENT_MS);
      const seen = await recorded(page);
      const waits = (s: Seen) =>
        /Esperando la app/.test(s.status) || s.banner !== "";
      const live = (s: Seen) => s.status === "En vivo";
      // her page went (the first state after Live that is not Live): "Loading their next page…",
      // never "Waiting…" at once — and "Waiting…" only once SILENT_GRACE_MS has run out (her next
      // page slower than the hold on this host), never before it
      const early: string[] = [];
      for (let i = 1; i < seen.length; i++) {
        if (!live(seen[i - 1]) || live(seen[i])) continue;
        const went = seen[i];
        if (waits(went)) {
          early.push(`at once: ${JSON.stringify(went)}`);
          continue;
        }
        const wait = seen.slice(i).find((s, j) =>
          waits(s) && !seen.slice(i, i + j).some(live)
        );
        if (wait && wait.at - went.at < SILENT_GRACE_MS - 250) {
          early.push(
            `${wait.at - went.at} ms after her page went: ${
              JSON.stringify(wait)
            }`,
          );
        }
      }
      expect(
        early.length === 0,
        `m5: the stage held her page — never 'Waiting for her app' at once or inside SILENT_GRACE_MS (${
          early.join(" | ")
        } of ${JSON.stringify(seen)})`,
      );
      const mixed = seen.filter((s) =>
        s.title === "Demo mode" && /Conectando|Conectado/.test(s.ghost)
      );
      expect(
        mixed.length === 0,
        `m5: her pill's copy never put the stage's Spanish beside her English (${
          JSON.stringify(mixed)
        })`,
      );
      // REQ-896 (p1) — a page that says "closing" (an address-bar navigation, a reload) is held
      // as the neutral "Un momento…": the first state after Live is never "Cargando su siguiente
      // página…" (that line is for a navigation, or — later — her next page claimed and loading)
      const wents = seen.filter((s, i) =>
        i > 0 && live(seen[i - 1]) && !live(s)
      );
      expect(
        wents.length > 0 && wents.every((s) => /Un momento/.test(s.status)),
        `m5/p1: her page going is held as 'Un momento…', never 'Cargando…' (${
          JSON.stringify(wents)
        } of ${JSON.stringify(seen)})`,
      );
      expect.eq(await statusOf(page), "En vivo", "and it is Live");
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-875 p4 (demo-loop cycle dm5) + REQ-896 (dm6, p1 + p7): the customer closes her only tab — through the SILENT_GRACE_MS hold ('One moment…', never 'Loading their next page…') the stage's copy of her pill never says 'Connecting…'; then 'Waiting for her app…' with no ghost of her pill at all", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // fleet-r38fa8936's pair: both English, so the ghost's word and the stage's are the same tongue
    const { userCtx, tab } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "en" },
      { width: 1000, height: 760 },
      "Live",
    );
    try {
      await until(
        "the stage draws her pill's copy, Connected",
        async () =>
          (await text(page, "[data-cy='demo-pill-ghost-status']")) ===
            "Connected",
        15_000,
      );
      await record(page);
      // her only tab closes: the page says "closing", the stage holds it as "between" for 2 s
      await tab.close();
      await until(
        "the stage waits for her app",
        async () => /Waiting for/.test(await statusOf(page)),
        SILENT_GRACE_MS + 15_000,
      );
      const seen = await recorded(page);
      const first = seen.findIndex((s) =>
        /Waiting for/.test(s.status) || s.banner !== ""
      );
      const hold = seen.slice(0, first < 0 ? seen.length : first);
      // REQ-896 (p1) — a closed tab's hold is "One moment…": the label never says she is
      // loading a page when the tab is gone
      expect(
        hold.some((s) => /One moment/.test(s.status)),
        `p1: the stage held her closed tab as 'One moment…' (${
          JSON.stringify(seen)
        })`,
      );
      expect(
        !hold.some((s) => /Loading their next page/.test(s.status)),
        `p1: never 'Loading their next page…' for a closed tab (${
          JSON.stringify(seen)
        })`,
      );
      // REQ-896 (p7) — once waiting, no ghost of her pill (it said "Connecting…" for a page
      // that was gone)
      const waiting = seen.slice(first < 0 ? seen.length : first);
      expect(
        waiting.length > 0 && waiting.every((s) => s.pill === ""),
        `p7: no ghost of her pill under the waiting banner (${
          JSON.stringify(waiting)
        })`,
      );
      const lying = hold.filter((s) => /Connecting|Conectando/.test(s.ghost));
      expect(
        lying.length === 0,
        `p4: her pill's copy never said 'Connecting…' while nothing was connecting (${
          JSON.stringify(lying)
        } of ${JSON.stringify(seen)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-838 p4 (demo-loop cycle dm2): the customer signs out — the stage says so and draws no copy of her pill, no 'move to show it' advice and none of his pointer over the screen she no longer has", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // a desktop window: her sidebar (with Log out) is on screen
    const { userCtx, tab } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "en" },
      { width: 1100, height: 780 },
      "Live",
    );
    try {
      await page.locator("[data-cy='demo-pill-ghost']").first().waitFor({
        timeout: 15_000,
      });
      // his mouse leaves the window: he points at nothing, and the stage advises him to move
      await page.evaluate(() =>
        document.documentElement.dispatchEvent(
          new PointerEvent("pointerleave"),
        )
      );
      await page.locator("[data-cy='demo-pointer-absent']").waitFor({
        timeout: 5_000,
      });

      await tab.locator("button.nav-item--logout").click();
      await until(
        "p4: the stage says Ana Torres signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      );
      await sleep(500);
      const problems: string[] = [];
      if ((await count(page, "[data-cy='demo-pill-ghost']")) > 0) {
        problems.push(
          `her pill's copy is still drawn ("${await text(
            page,
            "[data-cy='demo-pill-ghost']",
          )}")`,
        );
      }
      if ((await count(page, "[data-cy='demo-pointer-absent']")) > 0) {
        problems.push(
          `the stage still says "${await text(
            page,
            "[data-cy='demo-pointer-absent']",
          )}"`,
        );
      }
      // he moves over the frame: nothing of his pointer is drawn on a screen she does not have
      const f = await page.locator("[data-cy='demo-frame']").boundingBox();
      if (!f) throw new Error("no frame on the stage");
      for (let i = 0; i < 5; i++) {
        await page.mouse.move(
          f.x + f.width * (0.3 + 0.1 * i),
          f.y + f.height * 0.5,
          { steps: 3 },
        );
        await sleep(120);
      }
      await sleep(800);
      if ((await count(page, "[data-cy='demo-pointer-own']")) > 0) {
        problems.push("his 'You' marker is drawn");
      }
      if ((await count(page, "[data-cy='demo-pill-ghost']")) > 0) {
        problems.push("her pill's copy came back");
      }
      expect(
        problems.length === 0,
        `p4: while she is signed out: ${problems.join(" | ")}`,
      );
      expect.eq(
        await statusOf(page),
        "Ana Torres signed out",
        "still says she signed out",
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-838 p8 (demo-loop cycle dm2): the presenter leaves the stage — the customer's pill says 'Hans stepped away · The demo is still open', never 'Connecting…' under 'is guiding you'; he comes back: Connected", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "en" },
      { width: 1100, height: 780 },
      "Live",
    );
    try {
      expect.eq(await statusOf(tab), "Connected", "her pill is Connected");
      // her pill, every 40 ms, each change kept
      await tab.evaluate(() => {
        const w = globalThis as unknown as {
          __pmPill: unknown[];
          __pmPillTimer?: ReturnType<typeof setInterval>;
        };
        clearInterval(w.__pmPillTimer);
        w.__pmPill = [];
        let last = "";
        w.__pmPillTimer = setInterval(() => {
          const pill = document.querySelector("[data-cy='demo-pill']");
          const s = {
            data: pill?.getAttribute("data-status") ?? "",
            status: document.querySelector("[data-cy='demo-status']")
              ?.textContent?.trim() ?? "",
            line: document.querySelector("[data-cy='demo-details']")
              ?.textContent?.trim() ?? "",
          };
          const k = JSON.stringify(s);
          if (k !== last) {
            last = k;
            w.__pmPill.push(s);
          }
        }, 40);
      });
      // he leaves the stage for /admin (the demo stays open there: "Back to the demo")
      await page.goto(`${baseUrl}/admin`);
      await page.locator("[data-cy='demo-rejoin']").waitFor({
        timeout: 15_000,
      });
      // her pill brought out whole (it may fold to its tab while nobody is there)
      await until(
        "p8: her pill says Hans stepped away",
        async () => {
          await pillUp(tab, { timeout: 5_000 });
          return (await statusOf(tab)) === "Hans stepped away";
        },
        20_000,
      ).catch(async (e) => {
        throw new Error(
          `${(e as Error).message} — her pill showed ${
            JSON.stringify(
              await tab.evaluate(() =>
                (globalThis as unknown as { __pmPill: unknown[] }).__pmPill
              ),
            )
          }`,
        );
      });
      expect.eq(
        await tab.locator("[data-cy='demo-pill']").getAttribute("data-status"),
        "away",
        "her pill's state is 'away'",
      );
      const line = await text(tab, "[data-cy='demo-details']");
      expect(
        line.includes("The demo is still open") &&
          !line.includes("is guiding you"),
        `p8: the line says the demo is still open, not that Hans is guiding ("${line}")`,
      );
      const seen = await tab.evaluate(() =>
        (globalThis as unknown as { __pmPill: { status: string }[] }).__pmPill
      ) as { status: string }[];
      expect(
        !seen.some((s) => s.status === "Connecting…"),
        `p8: her pill never said Connecting… while her link was up (${
          JSON.stringify(seen)
        })`,
      );
      // he comes back: Connected, and Hans is guiding her again. A real mouse click on "Back to the
      // demo" (its /admin page hydrated long since): the runner's frame taken right after a click
      // that navigates to /demo/stage can stall 90 s on this host (REQ-823's evidence), so this
      // one is not framed — the URL and her pill below say what it did
      const back = await page.locator("[data-cy='demo-rejoin']").boundingBox();
      if (!back) throw new Error("no 'Back to the demo' on /admin");
      await page.mouse.click(
        back.x + back.width / 2,
        back.y + back.height / 2,
      );
      await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await until(
        "p8: her pill is Connected again",
        async () => {
          await pillUp(tab, { timeout: 5_000 });
          return (await statusOf(tab)) === "Connected";
        },
        20_000,
      );
      expect(
        (await text(tab, "[data-cy='demo-details']")).includes(
          "Hans is guiding you",
        ),
        "p8: and Hans is guiding her again",
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-645 AMENDMENT 2 (demo-loop run 8, p2): the customer closes her only tab and opens a new one — the stage goes Live on it with no 'Now showing her other tab' notice (she has one tab)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "en" },
      { width: 1000, height: 760 },
      "Live",
    );
    try {
      // her only tab closes; the stage holds, then waits for her app
      await tab.close();
      await until(
        "the stage waits for her app",
        async () => /Waiting for/.test(await statusOf(page)),
        SILENT_GRACE_MS + 15_000,
      );
      // a new tab of hers: her first, not "the other" one
      const next = await userCtx.newPage();
      await next.goto(`${baseUrl}/dashboard`);
      await pillUp(next, { live: true });
      await until(
        "the stage is Live on her new tab",
        async () => (await statusOf(page)) === "Live",
        30_000,
      );
      const t0 = Date.now();
      while (Date.now() - t0 < 6_000) {
        if ((await page.locator("[data-cy='demo-tab-switched']").count()) > 0) {
          throw new Error(
            `p2: the stage called her only tab 'the other tab': ${await text(
              page,
              "[data-cy='demo-tab-switched']",
            )}`,
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect.eq(
        await page.locator("[data-cy='demo-tab-switched']").count(),
        0,
        "no 'other tab' notice for a new tab after her only one closed",
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-838 AMENDMENT (demo-loop run 9, p4): the stage (re)loads while the customer is already connected — its status goes Connecting… → Live, never a flash of 'Waiting for Ana Torres's app' before her tab's presence lands", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx } = await demoOn(
      page,
      http,
      baseUrl,
      { user: "en", admin: "en" },
      { width: 1000, height: 760 },
      "Live",
    );
    try {
      // every status word the stage shows from its first paint, in order (a MutationObserver:
      // not a frame sampler — a one-render flash is recorded too)
      await page.addInitScript(() => {
        const w = globalThis as unknown as { __pmWords: string[] };
        w.__pmWords = [];
        let last = "";
        const look = () => {
          const el = document.querySelector("[data-cy='demo-status']");
          const s = el?.textContent?.trim() ?? "";
          if (s && s !== last) {
            last = s;
            w.__pmWords.push(s);
          }
        };
        // at document start there is no <html> yet: the document node itself is watched
        new MutationObserver(look).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        document.addEventListener("DOMContentLoaded", look);
      });
      await page.reload();
      await until(
        "the reloaded stage is Live on her screen",
        async () => (await statusOf(page)) === "Live",
        30_000,
      );
      await new Promise((r) => setTimeout(r, 1_000));
      const words = await page.evaluate(() =>
        (globalThis as unknown as { __pmWords: string[] }).__pmWords
      ) as string[];
      const live = words.indexOf("Live");
      expect(live >= 0, `the stage went Live (${JSON.stringify(words)})`);
      const before = words.slice(0, live);
      expect(
        before.every((s) => !/waiting/i.test(s)),
        `p4: no 'Waiting for her app' before Live over a customer who was there all along (${
          JSON.stringify(words)
        })`,
      );
    } finally {
      await userCtx.close();
    }
  }));
