/**
 * REQ-299 (demo cycle 1, issue p4 "heavy polling") — the demo's headless browser switched tabs for
 * every screenshot, and every switch back fired a catch-up fetch in every poll (conversations,
 * notifications, /demo-mode/active) on top of the schedule. In a real browser on /assistant: five
 * hide/show flaps inside one second produce ONE catch-up per poll, not five.
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<void> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Flap User", language: "en" }],
      ["/api/profile/identity", { businessName: "Flap Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

type Counts = { conversations: number; notifications: number; active: number };
const zero = (): Counts => ({ conversations: 0, notifications: 0, active: 0 });

/** counts the polled endpoints of the top document, with a timestamp per request */
function watchPolls(page: StoryTools["page"]) {
  let counts = zero();
  const log: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    const kind = u.includes("/api/agents/conversations?limit=50")
      ? "conversations"
      : u.includes("/api/notifications?limit=10")
      ? "notifications"
      : u.includes("/api/demo-mode/active")
      ? "active"
      : null;
    if (!kind || req.frame().name() !== "") return;
    counts[kind]++;
    log.push(`${new Date().toISOString()} ${kind}`);
  });
  return {
    get: (): Counts => ({ ...counts }),
    log: () => log.join("\n"),
    reset: () => {
      counts = zero();
      log.length = 0;
    },
  };
}

Deno.test("REQ-299: five tab flaps in a second give one catch-up per poll, not five", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    const polls = watchPolls(page);

    await page.goto("/assistant");
    await page.locator('[data-cy="mobile-menu"]').waitFor({
      state: "attached",
    });
    // let the mount-time fetches land, and get more than 2 s from them
    await page.waitForTimeout(3_000);

    polls.reset();
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => h,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => (h ? "hidden" : "visible"),
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    // five flaps 150 ms apart: each catch-up fetch has answered before the next flap, so the
    // in-flight guard alone would not hold them back — only the 2 s debounce does
    for (let i = 0; i < 5; i++) {
      await setHidden(true);
      await setHidden(false);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1_000);
    const c = polls.get();
    expect.eq(
      c.conversations,
      1,
      `one conversations catch-up for five flaps\n${polls.log()}`,
    );
    expect.eq(
      c.notifications,
      1,
      `one notifications catch-up for five flaps\n${polls.log()}`,
    );
    expect.eq(
      c.active,
      1,
      `one /demo-mode/active catch-up for five flaps\n${polls.log()}`,
    );
  }));
