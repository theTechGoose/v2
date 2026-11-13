/**
 * REQ-648 — demo-loop cycle 5, issues M3 ("the stage trails a customer page change by seconds
 * while lag reads 0.0s") and c4-m28 ("short-lived screens missed on stage; once ~5 s behind"),
 * end to end in two real browsers.
 *
 * Every page change in the app is a full document load. The customer's next page used to reach
 * the stage only once that page's island code had loaded and the overlay island had hydrated and
 * opened its link; on a slow dev server (a VM compiling the route cold) the stage held the old page
 * for seconds, the presenter's arrow landed on the wrong item of the new one, and the stage's lag
 * figure — measured from each frame's push — still said 0.0 s.
 *
 * Here the customer's island code is held back ISLAND_DELAY_MS (that slow VM) and the story
 * measures, on one clock (both browsers run on this machine), from the old page's pagehide to the
 * new page ON SHOW in the stage's frame:
 *   - the stage has her new page on show BEFORE her own app has hydrated (her pill drawn) — and,
 *     when the change took longer than the island delay, by at least half of it: the link and the
 *     snapshot start before the islands do (measured against her own hydration, so a loaded
 *     machine slows both sides alike);
 *   - the stage's own dev chip reports that page change ("page N.Ns"), close to the measured gap;
 *   - while the stage says "Loading their next page…" its frame is dimmed, and no pointer of the
 *     presenter's is sent against the page that is gone (the stage's changes are dated by mutation
 *     observers, the moment they happen);
 *   - the new page holds ONE demo socket: the overlay adopts the early link, it never opens a second.
 * Where her new page's time went (the document, the early script's modules, the overlay island,
 * the socket) is kept with the evidence (timeline.json), pass or fail.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** how long the customer's island code is held back: a slow VM's dev server */
const ISLAND_DELAY_MS = 6_000;
/** the stage's own page figure agrees with the measured gap within this — or within this share of
 *  it: the figure reads the deploy's clock as each browser estimates it (REQ-391), whose error
 *  grows with the round trips of a loaded machine */
const FIGURE_SLACK_MS = 1_000;
const FIGURE_SLACK_SHARE = 0.2;
/** setup steps on a loaded machine (many dev servers and browsers at once) */
const SLOW_MS = 60_000;

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
    await sleep(40);
  }
  throw new Error(`timed out: ${what}`);
}

/** a customer (Ana Torres) and a super admin (Hans), signed up fresh */
async function people(http: StoryTools["http"]) {
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  // past onboarding (REQ-091), so the app's pages are the customer's to move between
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
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
  await pg.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: SLOW_MS,
  });
  await pg.locator("[data-cy='adm-demo']").first().click();
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: SLOW_MS,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: SLOW_MS });
}

const statusOf = (pg: Page) =>
  pg.locator("[data-cy='demo-status']").innerText().then((s: string) =>
    s.trim()
  );
const framePath = (pg: Page) =>
  pg.locator("[data-cy='demo-frame']").getAttribute("data-path");
/** the stage is Live on `path` */
const liveOn = async (pg: Page, path: string, timeout = 25_000) => {
  let seen = "";
  await until(`the stage is Live on ${path}`, async () => {
    seen = `${await statusOf(pg)} on ${await framePath(pg)}`;
    return seen === `Live on ${path}`;
  }, timeout).catch(async (e) => {
    const chip = await pg.locator("[data-cy='demo-mirror-stats']").innerText()
      .catch(() => "");
    throw new Error(
      `${(e as Error).message} (it showed: ${seen}; its dev chip: ${chip})`,
    );
  });
};

/** what the stage showed, every change of it, and every pointer message it sent — on the server's
 *  relay or the peer data channel — each with this machine's clock. The frame's page and the pill's
 *  words are taken the moment they change (mutation observers: a timer is starved by input events
 *  on a loaded machine, and would date a page on show hundreds of ms late); the frame's look, a CSS
 *  transition, every 10 ms */
const watchStage = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmLog: { t: number; title: string; status: string; filter: string }[];
      __pmSent: { t: number; k: string }[];
      __pmTimer?: ReturnType<typeof setInterval>;
      __pmObs?: MutationObserver[];
      __pmWrapped?: boolean;
    };
    clearInterval(w.__pmTimer);
    for (const o of w.__pmObs ?? []) o.disconnect();
    w.__pmLog = [];
    w.__pmSent = [];
    let last = "";
    const frame = () =>
      document.querySelector<HTMLIFrameElement>("[data-cy='demo-frame']");
    const look = () => {
      const f = frame();
      const title = f?.contentDocument?.title ?? "";
      const status = document.querySelector("[data-cy='demo-status']")
        ?.textContent ?? "";
      const filter = f?.parentElement
        ? getComputedStyle(f.parentElement).filter
        : "";
      const key = `${title}|${status}|${filter}`;
      if (key === last) return;
      last = key;
      w.__pmLog.push({ t: Date.now(), title, status, filter });
    };
    let watched: Document | null = null;
    const observe = () => {
      const doc = frame()?.contentDocument ?? null;
      if (!doc || doc === watched) return;
      watched = doc;
      const o = new MutationObserver(look);
      o.observe(doc, { childList: true, subtree: true, characterData: true });
      w.__pmObs!.push(o);
    };
    w.__pmObs = [];
    const page = new MutationObserver(look);
    page.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    w.__pmObs.push(page);
    observe();
    w.__pmTimer = setInterval(() => {
      observe();
      look();
    }, 10);
    if (w.__pmWrapped) return;
    w.__pmWrapped = true;
    const wrap = (proto: { send: (d: unknown) => void }) => {
      const send = proto.send;
      proto.send = function (this: unknown, d: unknown) {
        try {
          const m = JSON.parse(String(d));
          // a relay to the colleagues (`to: "presenters"`) is not the customer's
          const k = m?.t === "relay" ? (m.to ? null : m.data?.k) : m?.k;
          if (k === "move" || k === "click") {
            w.__pmSent.push({ t: Date.now(), k });
          }
        } catch {
          // not ours
        }
        return send.call(this, d);
      };
    };
    wrap(WebSocket.prototype as unknown as { send: (d: unknown) => void });
    if (typeof RTCDataChannel !== "undefined") {
      wrap(
        RTCDataChannel.prototype as unknown as { send: (d: unknown) => void },
      );
    }
  });
const stageLog = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmLog: { t: number; title: string; status: string; filter: string }[];
      __pmSent: { t: number; k: string }[];
    };
    return { log: w.__pmLog, sent: w.__pmSent };
  }) as Promise<{
    log: { t: number; title: string; status: string; filter: string }[];
    sent: { t: number; k: string }[];
  }>;

Deno.test("REQ-648 (demo-loop cycle 5, M3 + c4-m28): with the customer's island code slow, their next page is on the stage well before it hydrates, the stage's dev chip reports the page change's real time, its frame is dimmed and his pointer is not sent while it waits, and the page holds one demo socket", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    /** each thing REQ-648 is about, found wrong: said together at the end */
    const problems: string[] = [];
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await tab.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemo(page, baseUrl, who.userPhone);
      await tab.reload();
      await pillUp(tab, { timeout: SLOW_MS });
      await liveOn(page, "/dashboard", SLOW_MS);
      const oldTitle = await tab.title();

      // the customer's pages say when they go and when their own app has hydrated (the first
      // moment its pill is drawn) — this machine's clock — and every demo socket a page of theirs
      // opens is counted
      await userCtx.addInitScript(() => {
        addEventListener("pagehide", () => {
          sessionStorage.setItem("pm:e2e-left", String(Date.now()));
        });
        const seen = new MutationObserver(() => {
          if (!document.querySelector("[data-cy='demo-pill']")) return;
          sessionStorage.setItem("pm:e2e-pill", String(Date.now()));
          seen.disconnect();
        });
        seen.observe(document, { childList: true, subtree: true });
      });
      // (an init script reaches the NEXT documents: the page on show says when it goes too)
      await tab.evaluate(() => {
        addEventListener("pagehide", () => {
          sessionStorage.setItem("pm:e2e-left", String(Date.now()));
        });
      });
      const sockets: number[] = [];
      tab.on("websocket", (ws: { url(): string }) => {
        if (ws.url().includes("/api/demo-mode/ws")) sockets.push(Date.now());
      });
      // a slow VM: every island module of the customer's next page comes ISLAND_DELAY_MS late
      await userCtx.route("**/fresh-island::*", async (
        // deno-lint-ignore no-explicit-any
        route: any,
      ) => {
        await sleep(ISLAND_DELAY_MS);
        await route.continue().catch(() => {});
      });

      await watchStage(page);
      // the presenter's mouse rests on the frame, on the old page's sidebar
      const box = await page.locator("[data-cy='demo-frame']").boundingBox();
      if (!box) throw new Error("no frame on the stage");
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await sleep(300);

      // the app itself changes page (a full load), as the assistant and every link do
      const clickedAt = Date.now();
      await tab.evaluate(() =>
        setTimeout(() => {
          location.href = "/customers";
        }, 0)
      );
      // "commit": her island code (and so her load event) is held back on purpose
      await tab.waitForURL(/\/customers/, {
        timeout: SLOW_MS,
        waitUntil: "commit",
      });
      // he keeps moving over the frame while the stage waits for her page
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(
          box.x + box.width * (0.2 + (i % 6) * 0.1),
          box.y + box.height * (0.25 + (i % 4) * 0.12),
        );
        await sleep(50);
      }
      let newTitle = "";
      await until("her new page has its title", async () => {
        newTitle = await tab.title();
        return newTitle !== "" && newTitle !== oldTitle;
      }, SLOW_MS);
      await until(
        "the stage shows the customer's new page",
        async () =>
          (await stageLog(page)).log.some((e) => e.title === newTitle),
        ISLAND_DELAY_MS + SLOW_MS,
      );
      const leftAt = Number(
        await tab.evaluate(() => sessionStorage.getItem("pm:e2e-left")),
      );
      if (!(leftAt >= clickedAt)) {
        throw new Error(`no pagehide time from the old page (${leftAt})`);
      }
      const { log } = await stageLog(page);
      const shownAt = log.find((e) => e.title === newTitle)!.t;
      const gap = shownAt - leftAt;

      // while the stage waited, its frame was dimmed, and nothing of his pointer went out
      const waitedFrom = log.find((e) =>
        e.t >= leftAt - 50 && /Loading their next page/.test(e.status)
      )?.t;
      const waiting = log.filter((e) =>
        e.t < shownAt && waitedFrom !== undefined && e.t >= waitedFrom
      );
      if (waitedFrom !== undefined) {
        // the frame as it was every 250 ms of the wait, once its filter's .3 s transition ran
        const at = (ms: number) =>
          [...log].reverse().find((e) => e.t <= ms) ?? log[0];
        const bright: { t: number; filter: string }[] = [];
        for (let ms = waitedFrom + 400; ms < shownAt; ms += 250) {
          const e = at(ms);
          if (!e.filter || e.filter === "none") {
            bright.push({ t: ms - leftAt, filter: e.filter });
          }
        }
        if (bright.length) {
          problems.push(
            `M3: the old page stayed at full brightness while the stage said it was loading their next page (${
              JSON.stringify(bright)
            }; waiting entries ${
              JSON.stringify(waiting.map((e) => ({ ...e, t: e.t - leftAt })))
            })`,
          );
        }
      }
      // the island code is still on its way: wait for her pill (hydrated), then for the stage
      await pillUp(tab, { timeout: ISLAND_DELAY_MS + SLOW_MS });
      await liveOn(page, "/customers", SLOW_MS);
      const pillAt = Number(
        await tab.evaluate(() => sessionStorage.getItem("pm:e2e-pill")),
      );
      if (!(pillAt > leftAt)) {
        throw new Error(`no hydration time from the new page (${pillAt})`);
      }
      // where her new page's time went (ms after the old page left): the document, the early
      // demo script's modules, the overlay island, the stylesheets — said with any problem below
      const timeline = await tab.evaluate((left: number) => {
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        const rel = (ms: number) =>
          Math.round(performance.timeOrigin + ms - left);
        return {
          doc: nav
            ? {
              responseStart: rel(nav.responseStart),
              responseEnd: rel(nav.responseEnd),
              domInteractive: rel(nav.domInteractive),
              domContentLoaded: rel(nav.domContentLoadedEventEnd),
            }
            : null,
          res: performance.getEntriesByType("resource")
            .filter((e) =>
              /demo-early|early-link|transport\.ts|mirror-record|fresh-island::DemoModeOverlay|\.css/
                .test(e.name)
            )
            .map((e) => ({
              n: e.name.replace(location.origin, "").slice(-48),
              from: rel(e.startTime),
              to: rel((e as PerformanceResourceTiming).responseEnd),
            })),
        };
      }, leftAt);
      const timelineText = `timeline (ms after her old page left): ${
        JSON.stringify({
          ...timeline,
          sockets: sockets.map((at) => at - leftAt),
          shown: gap,
          pill: pillAt - leftAt,
        })
      }`;
      // the stage did not wait for her islands: her page was on show before she hydrated — and,
      // when the page change took longer than the island delay (a loaded machine slows every step
      // of it), by most of that delay: waiting for the islands would put it after her pill
      const ahead = pillAt - shownAt;
      if (
        !(shownAt < pillAt) ||
        (gap >= ISLAND_DELAY_MS && ahead < ISLAND_DELAY_MS / 2)
      ) {
        problems.push(
          `M3: the stage had her new page on show ${gap} ms after the old one left — ${
            shownAt < pillAt ? `${ahead} ms before` : `${-ahead} ms AFTER`
          } her own app hydrated (its pill drawn ${
            pillAt - leftAt
          } ms after; her island code came ${ISLAND_DELAY_MS} ms late). The stage must not wait for her islands — log ${
            JSON.stringify(log.map((e) => ({ ...e, t: e.t - leftAt })))
          }`,
        );
      }
      // while the stage SAYS it is loading their next page (it cannot know earlier that her page
      // went; and while it says it waits for her app, nothing of hers is there to get a pointer):
      // each stretch of "Loading their next page…" before the new page was on show
      const { sent } = await stageLog(page);
      const loading: [number, number][] = [];
      log.forEach((e, i) => {
        if (e.t >= shownAt || !/Loading their next page/.test(e.status)) return;
        loading.push([e.t, Math.min(log[i + 1]?.t ?? shownAt, shownAt)]);
      });
      if (!loading.length) {
        problems.push(
          `M3: the stage never said it was loading their next page between her page going and the next on show`,
        );
      }
      const stalePointer = sent.filter((s) =>
        loading.some(([from, to]) => s.t >= from && s.t < to)
      );
      if (stalePointer.length) {
        problems.push(
          `M3: the stage sent his pointer ${stalePointer.length}× against the page that was gone (while the stage said it was loading their next page, before the new one was on show: ${
            JSON.stringify(stalePointer.map((s) => ({ ...s, t: s.t - leftAt })))
          })`,
        );
      }

      // the stage's own figure for that page change, in the dev chip
      const chip = await page.locator("[data-cy='demo-mirror-stats']")
        .innerText().catch(() => "");
      const m = /\bpage (\d+(?:\.\d+)?)/.exec(chip);
      if (!m) {
        problems.push(
          `M3: the dev chip reports no page figure (it says "${chip}") — the boot time stays hidden behind "lag"`,
        );
      } else {
        const figure = Number(m[1]) * 1000;
        const slack = Math.max(FIGURE_SLACK_MS, gap * FIGURE_SLACK_SHARE);
        if (Math.abs(figure - gap) > slack) {
          problems.push(
            `M3: the dev chip says the page change took ${figure} ms; it took ${gap} ms ("${chip}")`,
          );
        }
      }

      // one demo socket for the new page, even after its overlay hydrated
      await sleep(1_000);
      const opened = sockets.filter((at) => at >= leftAt - 50);
      if (opened.length !== 1) {
        problems.push(
          `the new page opened ${opened.length} demo socket(s) (wanted exactly 1: the overlay adopts the early link) at ${
            JSON.stringify(opened.map((at) => at - leftAt))
          } ms`,
        );
      }

      // kept with the evidence, pass or fail: and what the stage showed and sent, as it went
      const seen = await stageLog(page);
      await Deno.writeTextFile(
        `${folder}/timeline.json`,
        JSON.stringify(
          {
            problems,
            timeline: timelineText,
            stage: seen.log.map((e) => ({ ...e, t: e.t - leftAt })),
            sent: seen.sent.map((s) => ({ ...s, t: s.t - leftAt })),
          },
          null,
          2,
        ),
      );
      expect(
        problems.length === 0,
        `REQ-648: ${problems.join(" | ")} | ${timelineText}`,
      );
      expect.eq(await statusOf(page), "Live", "and the stage is Live");
    } finally {
      await userCtx.close();
    }
  }));
