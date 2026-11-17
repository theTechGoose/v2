/**
 * REQ-821 (demo-loop cycle dm1, issue m9) — the customer's pill opened folded on a dense page, so
 * "{name} is guiding you" (the REQ-153 amendment's join line) was never shown: REQ-545/637/781
 * fold the pill whenever page content is under every spot, and only a restart kept it whole.
 *
 * A super admin opens a demo on a contractor sitting on /customers (24 rows) in a 1280×800
 * desktop browser. Once the customer's pill is live, it is the WHOLE pill — status, "Alex from
 * DocuMonster is guiding you", End — for the first seconds, then it folds to its mini-pill (the
 * page is dense). A second contractor's demo: once the line has been up 2 s, a key press in the
 * page folds it at once (REQ-647's touched rule), well before the grace runs out.
 */
import { story, type StoryTools } from "#shots";
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
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

const GUIDE = "Alex from DocuMonster is guiding you";
/** REQ-821 — the grace (shared/demo-mode/restart.ts JOIN_SAY_MS) and REQ-647's minimum */
const JOIN_SAY_MS = 5_000;

type Sample = {
  t: number;
  status: string;
  folded: boolean;
  whole: boolean;
  endShown: boolean;
  text: string;
};

/**
 * Installed in the customer's page before it loads: samples the pill every 100 ms on the page's
 * own clock, so a slow host (the story's round trips) cannot blur the timeline. With
 * `pressAfter`, a key press in the page (the customer's input) comes that long after the pill
 * first said Connected.
 */
const recorder = (pressAfter: number | null) => {
  const w = globalThis as unknown as {
    __pill: Sample[];
    __pressedAt: number | null;
  };
  w.__pill = [];
  w.__pressedAt = null;
  let liveAt: number | null = null;
  const shown = (el: HTMLElement | null) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      getComputedStyle(el).visibility !== "hidden";
  };
  setInterval(() => {
    const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
    if (!pill) return;
    const t = performance.now();
    const status = pill.dataset.status ?? "";
    w.__pill.push({
      t,
      status,
      folded: pill.hasAttribute("data-tucked"),
      whole: shown(pill.querySelector("[data-cy='demo-status']")) &&
        !pill.hasAttribute("data-tucked"),
      endShown: shown(pill.querySelector("[data-cy='demo-end']")),
      text: (pill.innerText ?? "").replace(/\s+/g, " ").trim(),
    });
    if (status === "live" && liveAt === null) {
      liveAt = t;
      if (pressAfter !== null) {
        setTimeout(() => {
          w.__pressedAt = performance.now();
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
          );
        }, pressAfter);
      }
    }
  }, 100);
};

Deno.test("REQ-821 (demo-loop cycle dm1, m9): on join the customer's pill shows whole with '{name} is guiding you' and End on a dense page, then folds after the grace — or at once on the customer's input after 2 s", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const adminPhone = `+1843${digits()}`;
    async function contractor(name: string) {
      const phone = `+1512${digits()}`;
      const user = await verify(http, phone);
      await (await http("/api/me", {
        method: "PUT",
        headers: user.auth,
        body: JSON.stringify({ language: "en", name }),
      })).body?.cancel();
      await answerQuestions(http, user.auth, {
        name,
        businessName: `${name} Plumbing`,
      });
      for (let i = 0; i < 24; i++) {
        await post(http, user.auth, "/api/customers", {
          name: `Customer ${String(i + 1).padStart(2, "0")} Hansen`,
          email: `c${i}-${digits()}@blackhole.postmarkapp.com`,
          address: `${100 + i} Frederick Rd, Rockingham, VA`,
        });
      }
      return { phone, user };
    }
    const ana = await contractor("Ana Torres");
    const ben = await contractor("Ben Ortiz");
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

    let first = true;
    // deno-lint-ignore no-explicit-any
    const others: any[] = [];
    /** the customer sits on /customers (the pill sampled); the admin opens the demo */
    async function join(
      who: { phone: string; user: { cookie: string } },
      pressAfter: number | null,
    ) {
      const ctx = await browser!.newContext({
        viewport: { width: 1280, height: 800 },
      });
      await ctx.addInitScript(recorder, pressAfter);
      const userPage = await ctx.newPage();
      await useCookie(ctx, baseUrl, who.user.cookie);
      await userPage.goto(`${baseUrl}/customers`);
      await userPage.getByText("Customer 12 Hansen").first().waitFor({
        timeout: 30_000,
      });
      // the stage signs this browser in as the customer (REQ-153): each demo is opened from a
      // fresh admin session, as a second staff browser would
      const staff = first ? page : await (async () => {
        const c = await browser!.newContext({
          viewport: { width: 1280, height: 800 },
        });
        others.push(c);
        return await c.newPage();
      })();
      first = false;
      const session = await verify(http, adminPhone);
      await useCookie(staff.context(), baseUrl, session.cookie);
      await staff.goto(`${baseUrl}/admin`);
      await staff.locator("[data-cy='adm-q']").fill(who.phone.slice(2));
      await staff.locator("[data-cy='adm-search']").click();
      await staff.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await staff.locator("[data-cy='adm-demo']").first().click();
      await staff.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      return { ctx, userPage };
    }

    /** the pill's timeline once it has been live and then folded (or `ms` has passed live) */
    async function timeline(
      userPage: Awaited<ReturnType<typeof join>>["userPage"],
      ms: number,
    ) {
      const read = () =>
        userPage.evaluate(() => {
          const w = globalThis as unknown as {
            __pill: Sample[];
            __pressedAt: number | null;
          };
          return { pill: w.__pill, pressedAt: w.__pressedAt };
        });
      await until("the customer's pill goes live, then folds", async () => {
        const { pill } = await read();
        const live = pill.find((p) => p.status === "live");
        if (!live) return `not live yet — last ${JSON.stringify(pill.at(-1))}`;
        const folded = pill.some((p) => p.t > live.t && p.folded);
        const last = pill.at(-1)!;
        return folded || last.t - live.t > ms ? null : "still whole";
      }, 40_000);
      const { pill, pressedAt } = await read();
      const t0 = pill.find((p) => p.status === "live")!.t;
      const rel = pill.filter((p) => p.t >= t0).map((p) => ({
        ...p,
        t: Math.round(p.t - t0),
      }));
      return {
        rel,
        pressedAt: pressedAt === null ? null : Math.round(pressedAt - t0),
        firstFold: rel.find((p) => p.folded)?.t ?? null,
      };
    }

    const brief = (rel: Array<Sample>) =>
      JSON.stringify(
        rel.map((p) =>
          `${p.t}:${p.folded ? "folded" : p.whole ? "whole" : "?"}:${
            p.text.slice(0, 60)
          }`
        ),
      ).slice(0, 2_500);

    /** every sample in [0, until) is the whole pill with the guide's line and End */
    function wholeUntil(rel: Array<Sample>, until: number, what: string) {
      const early = rel.filter((p) => p.t < until);
      expect(early.length >= 2, `${what}: sampled while live — ${brief(rel)}`);
      const bad = early.find((p) =>
        !p.whole || !p.endShown || !p.text.includes(GUIDE)
      );
      expect(
        bad === undefined,
        `${what}: the pill shows whole with "${GUIDE}" and End for its first ${until} ms live — ${
          brief(rel)
        }`,
      );
    }

    // 1. a first join: whole for the first seconds, then it yields to the dense page
    const a = await join(ana, null);
    try {
      const { rel, firstFold } = await timeline(
        a.userPage,
        JOIN_SAY_MS + 5_000,
      );
      await a.userPage.screenshot({ path: `${folder}/join-after.png` });
      wholeUntil(rel, 2_500, "first join");
      expect(
        firstFold !== null && firstFold >= 2_500 &&
          firstFold <= JOIN_SAY_MS + 3_000,
        `after the grace the pill folds to its mini-pill (the page is dense) — first fold at ${firstFold} ms — ${
          brief(rel)
        }`,
      );
    } finally {
      await a.ctx.close();
    }

    // 2. another join: after 2 s a key press in the page is the line read — it folds at once
    const b = await join(ben, 2_300);
    try {
      const { rel, firstFold, pressedAt } = await timeline(
        b.userPage,
        JOIN_SAY_MS + 5_000,
      );
      await b.userPage.screenshot({ path: `${folder}/input-after.png` });
      expect(pressedAt !== null, "the key was pressed in the page");
      wholeUntil(rel, pressedAt!, "before the key press");
      expect(
        firstFold !== null && firstFold >= pressedAt! &&
          firstFold <= pressedAt! + 1_500 && firstFold < JOIN_SAY_MS,
        `the customer's input folds the pill well before the grace ends — pressed at ${pressedAt} ms, first fold at ${firstFold} ms — ${
          brief(rel)
        }`,
      );
    } finally {
      await b.ctx.close();
      for (const c of others) await c.close();
    }
  }));
