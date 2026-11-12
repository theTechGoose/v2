/**
 * REQ-221 — the demo found heavy polling of /api/agents/conversations?limit=50 and
 * /api/notifications?limit=10 (demo issue `pointer-and-replica-side-effects-polling`). In a real
 * browser on /assistant (DashTopbar + AsstThreads):
 *  - the page itself polls (the control: conversations on mount, notifications on its period),
 *  - the same page loaded in a frame sandboxed like the demo stage's (REQ-242: `allow-same-origin`,
 *    no scripts) sends neither request at all,
 *  - a hidden page sends neither, and catches up with one conversations fetch when shown again.
 */
import { story, type StoryTools } from "#shots";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };
/** a little over DashTopbar's 10 s notifications period, so every poll gets a chance to fire */
const WINDOW_MS = 11_500;

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
      ["/api/me", { name: "Poll User", language: "en" }],
      ["/api/profile/identity", { businessName: "Poll Business" }],
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

type Counts = { conversations: number; notifications: number };

/** counts the two polled endpoints per frame name ("" = the top document) */
function watchPolls(page: StoryTools["page"]) {
  const by = new Map<string, Counts>();
  page.on("request", (req) => {
    const u = req.url();
    const kind = u.includes("/api/agents/conversations?limit=50")
      ? "conversations"
      : u.includes("/api/notifications?limit=10")
      ? "notifications"
      : null;
    if (!kind) return;
    const name = req.frame().name();
    const c = by.get(name) ?? { conversations: 0, notifications: 0 };
    c[kind]++;
    by.set(name, c);
  });
  return {
    of: (frame: string): Counts => ({
      ...(by.get(frame) ?? { conversations: 0, notifications: 0 }),
    }),
    reset: () => by.clear(),
  };
}

Deno.test("REQ-221: the demo stage's kind of frame and a hidden page do not poll conversations or notifications; the visible page does", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    const polls = watchPolls(page);

    // the control — the visible page polls
    await page.goto("/assistant");
    await page.locator('[data-cy="mobile-menu"]').waitFor({
      state: "attached",
    });
    await page.waitForTimeout(WINDOW_MS);
    const top = polls.of("");
    expect(
      top.conversations >= 1,
      `the visible page fetched conversations (${top.conversations})`,
    );
    expect(
      top.notifications >= 1,
      `the visible page fetched notifications (${top.notifications})`,
    );

    // REQ-242 — the demo stage's frame: the same page, sandboxed as the stage sandboxes its
    // mirror (allow-same-origin, no scripts)
    polls.reset();
    await page.evaluate(() => {
      const f = document.createElement("iframe");
      f.name = "pm-demo-stage-frame";
      f.setAttribute("sandbox", "allow-same-origin");
      f.src = "/assistant";
      f.style.cssText =
        "position:fixed;left:0;top:0;width:1024px;height:700px;z-index:99999";
      document.body.appendChild(f);
    });
    const frame = page.frameLocator('iframe[name="pm-demo-stage-frame"]');
    await frame.locator("body").waitFor({ state: "attached" });
    await page.waitForTimeout(WINDOW_MS);
    const staged = polls.of("pm-demo-stage-frame");
    expect.eq(
      staged.conversations,
      0,
      "the stage's kind of frame fetched no conversations",
    );
    expect.eq(
      staged.notifications,
      0,
      "the stage's kind of frame fetched no notifications",
    );
    await page.evaluate(() =>
      document.querySelector('iframe[name="pm-demo-stage-frame"]')?.remove()
    );

    // a hidden page — nothing while hidden, one catch-up when shown
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
    await setHidden(true);
    polls.reset();
    await page.waitForTimeout(WINDOW_MS);
    const hidden = polls.of("");
    expect.eq(
      hidden.conversations,
      0,
      "a hidden page fetched no conversations",
    );
    expect.eq(
      hidden.notifications,
      0,
      "a hidden page fetched no notifications",
    );
    await setHidden(false);
    await page.waitForTimeout(1_000);
    expect(
      polls.of("").conversations >= 1,
      "shown again, the page caught up on conversations",
    );
  }));
