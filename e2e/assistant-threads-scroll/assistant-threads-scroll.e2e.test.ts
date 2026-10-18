/**
 * REQ-045 — Raphael, 2026-09-30: "in the assistant view, the overflow for the
 * different chat needs to be scroll. the problem is that i get many
 * conversations going and it pushes the chat input below the fold."
 *
 * The assistant shell is pinned to the viewport (REQ-052's rule in
 * front-end/static/assistant-page.css), so the conversations column
 * (.threads__list) and the transcript are the scrollers: however many
 * conversations a contractor has, the page itself does not grow and the
 * composer stays on screen. 40 seeded conversations overflow every viewport
 * below several times over.
 *
 * Pages: front-end/routes/assistant/index.tsx and /assistant/[id] (island
 * front-end/islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";

const PHONE = "+15125550945";
const SEED = 40;
const JSON_HEADERS = { "content-type": "application/json" };

/** A signed-in, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: PHONE, code: "000000" }),
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
      ["/api/me", { name: "Scroll User", language: "en" }],
      ["/api/profile/identity", { businessName: "Scroll Business" }],
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
  // The cookie must be set for the host the runner actually serves on — the
  // gate uses 127.0.0.1, a pin uses localhost.
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** Enough conversations to overflow the list on any of the viewports below. */
async function seedConversations(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<string> {
  const list = await http("/api/agents/conversations?limit=50", {
    headers: auth,
  });
  const have = await list.json();
  const count = Array.isArray(have) ? have.length : 0;
  for (let i = count; i < SEED; i++) {
    const res = await http("/api/agents/conversations", {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    await res.body?.cancel();
  }
  const again = await http("/api/agents/conversations?limit=1", {
    headers: auth,
  });
  const first = await again.json();
  return first[0].id as string;
}

interface Fit {
  innerHeight: number;
  docScrollHeight: number;
  sendTop: number;
  sendBottom: number;
  listScrollHeight: number;
  listClientHeight: number;
  listOverflowY: string;
}
function measure(page: StoryTools["page"]): Promise<Fit> {
  return page.evaluate(() => {
    const send = document.querySelector("button.composer__send")
      ?.getBoundingClientRect();
    const list = document.querySelector(".threads__list") as HTMLElement | null;
    return {
      innerHeight: globalThis.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      sendTop: Math.round(send?.top ?? -1),
      sendBottom: Math.round(send?.bottom ?? 1e9),
      listScrollHeight: list?.scrollHeight ?? 0,
      listClientHeight: list?.clientHeight ?? 0,
      listOverflowY: list ? getComputedStyle(list).overflowY : "",
    };
  });
}

async function assertShellFitsViewport(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  where: string,
) {
  const m = await measure(page);
  expect(
    m.docScrollHeight <= m.innerHeight,
    `${where}: the page itself does not scroll (document ${m.docScrollHeight}px ≤ window ${m.innerHeight}px)`,
  );
  expect(
    m.sendTop >= 0 && m.sendBottom <= m.innerHeight,
    `${where}: the composer's send button is inside the window, unscrolled (top ${m.sendTop}, bottom ${m.sendBottom} of ${m.innerHeight})`,
  );
}

async function assertListScrolls(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  where: string,
) {
  const m = await measure(page);
  expect(
    m.listScrollHeight > m.listClientHeight,
    `${where}: the conversation list overflows its column (${m.listScrollHeight}px of content in ${m.listClientHeight}px)`,
  );
  expect(
    /auto|scroll/.test(m.listOverflowY),
    `${where}: the list is a scroller (overflow-y ${m.listOverflowY})`,
  );
  const scrollTop = await page.evaluate(() => {
    const list = document.querySelector(".threads__list") as HTMLElement;
    list.scrollTo({ top: 400 });
    return list.scrollTop;
  });
  expect(
    scrollTop > 0,
    `${where}: the list actually scrolls (scrollTop ${scrollTop})`,
  );
}

async function openWithThreads(page: StoryTools["page"], path: string) {
  await page.goto(path);
  await page.locator(".thread").nth(SEED - 1).waitFor({ state: "attached" });
  await page.locator("button.composer__send").waitFor({ state: "attached" });
}

Deno.test("REQ-045: the conversation list scrolls inside its own column instead of growing the page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await seedConversations(http, auth);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWithThreads(page, "/assistant");
    expect.eq(
      (await page.locator(".thread").count()) >= SEED,
      true,
      `${SEED} conversations are listed`,
    );
    await assertListScrolls(page, expect, "/assistant 1440×900");
    await assertShellFitsViewport(page, expect, "/assistant 1440×900");
  }));

Deno.test("REQ-045: with many conversations the chat input stays above the fold, on a tall and a short window and on an open thread", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const threadId = await seedConversations(http, auth);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWithThreads(page, "/assistant");
    await assertShellFitsViewport(page, expect, "/assistant 1440×900");
    // A short laptop window: the old 720px floor on the grid clipped the
    // composer under the shell's overflow:hidden; the inner scrollers absorb
    // the height instead.
    await page.setViewportSize({ width: 1280, height: 720 });
    await assertShellFitsViewport(page, expect, "/assistant 1280×720");
    await assertListScrolls(page, expect, "/assistant 1280×720");
    // The same holds on an open thread.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWithThreads(page, `/assistant/${threadId}`);
    await assertListScrolls(page, expect, "/assistant/<id> 1440×900");
    await assertShellFitsViewport(page, expect, "/assistant/<id> 1440×900");
  }));
