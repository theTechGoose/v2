/**
 * REQ-305 — demo issues M2, M7, m16 and setup-m6 (demo-loop cycle 1), in two browsers: the admin
 * on the stage, the customer on their own quote's public page (/q/<id> — a long page whose window
 * scrolls).
 *
 *   1. M7, m16, setup-m6 — the customer scrolls by `window.scrollTo`, by End and Home, and by an
 *      in-page anchor link, moving the mouse a pixel right after each (the move outruns the scroll
 *      op on the wire): after each the stage frame's scroll is the customer's, and the customer's
 *      pointer on the stage sits over the SAME mirrored element as their cursor does on their
 *      screen — never below the frame, never a page's worth down, never a neighbour.
 *   2. M2 — the presenter rests on an element of the frame; the customer goes to another page under
 *      the still mouse (one whose stylesheets the stage has never loaded), then reloads it: each
 *      time the customer's arrow is on the element under the presenter's cursor in the new mirror
 *      (the stage looks for that node only once the mirror is styled — never in the unstyled page
 *      the browser lays out first); REQ-393 AMENDMENT (demo M2, cycle 2): once the mirror has
 *      settled and the customer scrolls, the arrow stays under the presenter's still cursor, on the
 *      element the mirror now has there.
 *      REQ-451 AMENDMENT (demo M1, cycle 3): the arrow is what he POINTED AT. After the page change
 *      and after the reload the customer's new page shows no arrow while his mouse is still (what
 *      he pointed at was on the page that went — never the spot under his mouse, over whatever is
 *      there now); his next move puts it on the element under his cursor in the new mirror. When
 *      the customer scrolls, the arrow rides with its element, and the stage draws a faint ghost
 *      of it on that element in the frame (his own cursor stays where it was).
 *      REQ-538 AMENDMENT (demo M1, cycle 4): an anchor that died (another page, a reload) is looked
 *      up again ONCE under his still mouse when the new mirror has settled — the arrow is back on
 *      the element under his cursor with no move, and the stage's "isn't on their screen" hint is
 *      gone.
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

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  let last: unknown = null;
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out: ${what}${last ? ` (last error: ${last})` : ""}`);
}

type Page = StoryTools["page"];
const FRAME = "[data-cy='demo-frame']";
const VIEW = { width: 420, height: 800 };

/**
 * One element's place in its page, the same on the customer's page and in the mirror: the tag and
 * the index among the siblings both have (never what the recorder leaves out: a script, a
 * preload, the demo overlay, the staff banner). Evaluated in the page it is for — no closure,
 * Playwright serialises the function.
 */
const PATH_OF = `(el) => {
  const skip = (c) => ["SCRIPT", "NOSCRIPT", "TEMPLATE", "BASE"].includes(c.tagName) ||
    (c.tagName === "LINK" && !/(^|\\s)(stylesheet|icon)(\\s|$)/i.test(c.getAttribute("rel") || "")) ||
    (c.tagName === "META" && c.hasAttribute("http-equiv")) ||
    c.hasAttribute("data-demo-overlay") || c.hasAttribute("data-demo-skip");
  const parts = [];
  for (let n = el; n && n.parentElement; n = n.parentElement) {
    const sibs = Array.from(n.parentElement.children).filter((c) => !skip(c));
    parts.unshift(n.tagName + ":" + sibs.indexOf(n));
  }
  return parts.join("/");
}`;

/** the page element under a point of the customer's screen (the demo's own chrome not counted) */
const underCustomer = (page: Page, x: number, y: number) =>
  page.evaluate(
    `(() => { const el = document.elementsFromPoint(${x}, ${y}).find((e) => !e.closest("[data-demo-overlay]")) ?? null; return el ? (${PATH_OF})(el) : null; })()`,
  ) as Promise<string | null>;

/** the mirrored element under a point of the FRAME (the customer's CSS px), from the stage page */
const underMirror = (page: Page, x: number, y: number) =>
  page.evaluate(
    `(() => { const f = document.querySelector(${
      JSON.stringify(FRAME)
    }); const d = f && f.contentDocument; if (!d) return null; const el = d.elementFromPoint(${x}, ${y}); return el ? (${PATH_OF})(el) : null; })()`,
  ) as Promise<string | null>;

/** a document's height and its body's children's, to say where two documents differ */
const HEIGHTS = `(d) => {
  d = d && d.nodeType === 9 ? d : document;
  const se = d.scrollingElement;
  const kids = Array.from(d.body.children).map((c) =>
    c.tagName + "." + (c.className || "") + ":" + Math.round(c.getBoundingClientRect().height)
  );
  return { scrollHeight: se.scrollHeight, clientHeight: se.clientHeight, kids };
}`;

const mirrorScrollTop = (page: Page) =>
  page.evaluate(
    `(() => { const f = document.querySelector(${
      JSON.stringify(FRAME)
    }); const d = f && f.contentDocument; return d && d.scrollingElement ? d.scrollingElement.scrollTop : -1; })()`,
  ) as Promise<number>;

/** REQ-451 — the stage's faint ghost of the presenter's arrow (where the customer's screen has it) */
const ghostAt = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-cy='demo-pointer-ghost']");
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42, outside: el.hasAttribute("data-outside") };
  });

const pointerAt = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === n);
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42, outside: el.hasAttribute("data-outside") };
  }, name);

/** the demo on the customer's account: the admin on the stage, the customer's page on `start` */
async function demoOn(
  tools: StoryTools,
  start: (q: { id: string }) => string,
) {
  const { page, expect, http, baseUrl } = tools;
  await page.setViewportSize({ width: 1280, height: 860 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  // the customer's own quote, sent: its public page is long enough to scroll
  const customer = await post(http, user.auth, "/api/customers", {
    name: "Hans Hansen",
    email: "hans@blackhole.postmarkapp.com",
    address: "725 Frederick Rd, Rockingham, VA",
  });
  const quote = await post(http, user.auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Deck rebuild — Hans Hansen",
    jobName: "Deck rebuild",
    description:
      "Tear out and rebuild the back deck: footings, framing, decking, rails and stairs.",
    lineItems: [
      { description: "Demolition", quantity: 1, unit: "job", price: 20000 },
      { description: "Framing", quantity: 1, unit: "job", price: 40000 },
      { description: "Decking", quantity: 1, unit: "job", price: 30000 },
      {
        description: "Rails and stairs",
        quantity: 1,
        unit: "job",
        price: 10000,
      },
    ],
    estimatedTotal: 100000,
    status: "draft",
  });
  await (await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ status: "sent" }),
  })).body?.cancel();
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
  expect.eq(boot.status, 200, "the admin phone is a super admin");
  await boot.body?.cancel();

  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport: VIEW });
  await useCookie(userCtx, baseUrl, user.cookie);
  const userPage = await userCtx.newPage();

  // the admin opens the demo and lands on the stage
  await useCookie(page.context(), baseUrl, admin.cookie);
  await page.goto("/admin");
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: 15_000,
  });
  await page.locator("[data-cy='adm-demo']").first().click();
  await page.waitForURL((u) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await page.locator("[data-cy='demo-connecting']").waitFor({
    timeout: 15_000,
  });

  // the customer opens their start page; the stage mirrors it
  const startPath = start(quote);
  await userPage.goto(`${baseUrl}${startPath}`);
  await until(
    `the stage's mirror is on the customer's ${startPath}`,
    async () =>
      (await page.locator(FRAME).getAttribute("data-path")) === startPath,
    25_000,
  );

  // the frame's box on the stage and its scale: a stage point ↔ a point of the customer's screen
  const fb = await page.locator(FRAME).boundingBox();
  if (!fb) throw new Error("no frame box");
  const s = fb.width / VIEW.width;
  const toFrame = (p: { x: number; y: number }) => ({
    x: (p.x - fb.x) / s,
    y: (p.y - fb.y) / s,
  });
  const toStage = (p: { x: number; y: number }) => ({
    x: fb.x + p.x * s,
    y: fb.y + p.y * s,
  });

  /** the customer's window scroll once it stops moving (End and Home scroll smoothly) */
  const settledScrollY = async () => {
    let last = await userPage.evaluate(() => globalThis.scrollY);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const now = await userPage.evaluate(() => globalThis.scrollY);
      if (now === last) return now;
      last = now;
    }
    return last;
  };
  /** the stage frame's scroll comes to the customer's settled one */
  const frameFollows = async (what: string) => {
    const want = await settledScrollY();
    await until(
      `${what}: the stage frame's scroll follows the customer's (${want})`,
      async () => {
        const got = await mirrorScrollTop(page);
        if (Math.abs(got - want) <= 1) return true;
        // the two documents, measured: where does the mirror's height differ?
        const theirs = await userPage.evaluate(`(${HEIGHTS})(document)`);
        const mine = await page.evaluate(
          `(() => { const f = document.querySelector(${
            JSON.stringify(FRAME)
          }); return (${HEIGHTS})(f.contentDocument); })()`,
        );
        throw new Error(
          `mirror at ${got}; customer ${JSON.stringify(theirs)}; mirror ${
            JSON.stringify(mine)
          }`,
        );
      },
      8_000,
    );
    return want;
  };
  /** the mirror's document is laid out like the customer's (its stylesheets are in) */
  const mirrorAsTall = (what: string) =>
    until(
      `${what}: the mirror is laid out like the customer's page`,
      async () => {
        const theirs = await userPage.evaluate(() =>
          document.scrollingElement?.scrollHeight ?? 0
        );
        const mine = await page.evaluate(
          `(() => { const d = document.querySelector(${
            JSON.stringify(FRAME)
          }).contentDocument; return d.scrollingElement.scrollHeight; })()`,
        ) as number;
        return Math.abs(theirs - mine) <= 2;
      },
      15_000,
    );
  return {
    userCtx,
    userPage,
    quote,
    startPath,
    toFrame,
    toStage,
    frameFollows,
    mirrorAsTall,
  };
}

Deno.test("REQ-305 (demo M7, m16, setup-m6): the customer scrolls /q by window.scrollTo, End/Home and an anchor link — the stage frame's scroll follows each, and the customer's pointer on the stage stays over the element under their cursor, inside the frame", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const d = await demoOn(tools, (q) => `/q/${q.id}`);
    const { userPage, toFrame, frameFollows } = d;
    try {
      await d.mirrorAsTall("the quote page");
      const pageHeight = await userPage.evaluate(() =>
        document.scrollingElement?.scrollHeight ?? 0
      );
      expect(
        pageHeight > VIEW.height + 400,
        `the quote page is long enough to scroll (${pageHeight}px tall at ${VIEW.height})`,
      );

      /** the customer's pointer on the stage sits over the element under their cursor */
      const customerPointerOnItsNode = async (
        what: string,
        cursor: { x: number; y: number },
      ) => {
        await until(
          `${what}: the customer's pointer on the stage is over the element under their cursor`,
          async () => {
            const at = await pointerAt(page, "Ana Torres");
            if (!at) throw new Error("no customer pointer on the stage");
            const inFrame = toFrame(at);
            const onStage = await underMirror(page, inFrame.x, inFrame.y);
            const onScreen = await underCustomer(userPage, cursor.x, cursor.y);
            const ok = !at.outside && onStage !== null &&
              onStage === onScreen &&
              Math.abs(inFrame.x - cursor.x) <= 2 &&
              Math.abs(inFrame.y - cursor.y) <= 2;
            if (!ok) {
              // the mirror under the cursor's own point, and both scroll states: is the layout
              // the same and the arrow misplaced, or is the mirror elsewhere?
              const sameSpot = await underMirror(page, cursor.x, cursor.y);
              const scrolls = {
                mirror: await mirrorScrollTop(page),
                customer: await userPage.evaluate(() => globalThis.scrollY),
              };
              throw new Error(
                `stage ${
                  JSON.stringify({ ...inFrame, outside: at.outside })
                } → ${onStage} · screen ${
                  JSON.stringify(cursor)
                } → ${onScreen} · mirror at the cursor's point → ${sameSpot} · ${
                  JSON.stringify(scrolls)
                }`,
              );
            }
            return true;
          },
          8_000,
        );
      };

      // 1. the customer's cursor rests on the page: the stage shows it on the same element
      const cursor = { x: 200, y: 300 };
      await userPage.mouse.move(cursor.x - 20, cursor.y - 10);
      await userPage.mouse.move(cursor.x, cursor.y);
      await customerPointerOnItsNode("at rest", cursor);

      // 2. window.scrollTo halfway down, the mouse moved a pixel right after (M7: the move reaches
      //    the stage before the scroll op; setup-m6: a scripted scroll is mirrored like a wheel's)
      const half = Math.round((pageHeight - VIEW.height) / 2);
      await userPage.evaluate((y) => globalThis.scrollTo(0, y), half);
      cursor.y += 1;
      await userPage.mouse.move(cursor.x, cursor.y);
      const y1 = await frameFollows(`window.scrollTo(0, ${half})`);
      expect(
        y1 >= 200,
        `the customer's page scrolled by script (scrollY ${y1})`,
      );
      await customerPointerOnItsNode("after window.scrollTo", cursor);

      // 3. End, then Home (keyboard scrolling of the window)
      await userPage.keyboard.press("End");
      cursor.y += 1;
      await userPage.mouse.move(cursor.x, cursor.y);
      const y2 = await frameFollows("End");
      expect(y2 > y1, `End scrolled further down (${y2} > ${y1})`);
      await customerPointerOnItsNode("after End", cursor);
      await userPage.keyboard.press("Home");
      cursor.y += 1;
      await userPage.mouse.move(cursor.x, cursor.y);
      const y3 = await frameFollows("Home");
      expect.eq(y3, 0, "Home scrolled back to the top");
      await customerPointerOnItsNode("after Home", cursor);

      // 4. an in-page anchor link to the sign form's name field
      const target = `sign-name-${d.quote.id}`;
      expect.eq(
        await userPage.locator(`[id="${target}"]`).count(),
        1,
        "the quote page has the sign form's name field to jump to",
      );
      await userPage.evaluate((id) => {
        const a = document.createElement("a");
        a.href = `#${id}`;
        a.id = "pm-jump";
        a.textContent = "Jump to signing";
        a.style.cssText =
          "position:fixed;top:4px;left:4px;z-index:5;background:#fff;padding:4px";
        document.body.prepend(a);
      }, target);
      await userPage.locator("#pm-jump").click();
      cursor.y += 1;
      await userPage.mouse.move(cursor.x, cursor.y);
      const y4 = await frameFollows("the anchor link");
      expect(y4 > 200, `the anchor link scrolled the page (scrollY ${y4})`);
      await customerPointerOnItsNode("after the anchor link", cursor);
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-305 (demo M2) + REQ-451 (demo M1) + REQ-538 (cycle 4 M1): after the customer goes to another page and after a reload the arrow comes back with his mouse still, once the mirror has settled, on the element under his cursor — never on what an unstyled mirror put there; when the customer scrolls it rides with its element and the stage draws its ghost there", (t) =>
  story(t, async (tools) => {
    const { page, expect, baseUrl } = tools;
    const d = await demoOn(tools, () => "/customers");
    const { userPage, toStage, frameFollows } = d;
    try {
      await d.mirrorAsTall("the customers page");
      // the presenter rests on an element of the frame
      const rest = { x: 210, y: 420 };
      const stagePt = toStage(rest);
      await page.mouse.move(stagePt.x - 30, stagePt.y - 15);
      await page.mouse.move(stagePt.x, stagePt.y);
      const presenterOnItsNode = async (what: string) => {
        await until(
          `${what}: the presenter's arrow on the customer's screen is on the element under the presenter's cursor`,
          async () => {
            const meant = await underMirror(page, rest.x, rest.y);
            const at = await pointerAt(userPage, "Hans");
            if (!at) {
              throw new Error("no presenter arrow on the customer's screen");
            }
            if (!meant) {
              throw new Error("nothing mirrored under the presenter's cursor");
            }
            const shown = await underCustomer(userPage, at.x, at.y);
            if (at.outside || shown !== meant) {
              throw new Error(
                `presenter → ${meant} · arrow ${JSON.stringify(at)} → ${shown}`,
              );
            }
            return true;
          },
          8_000,
        );
      };
      await presenterOnItsNode("at rest on /customers");

      // 1. the customer goes to their quote's page under the still mouse: a new mirror, whose
      //    stylesheets the stage has never loaded — its first layout is the unstyled one.
      //    REQ-451 (M1): what he pointed at was on /customers — never the spot under his mouse
      //    over whatever an unsettled /q has there. REQ-538 AMENDMENT (demo cycle 4, M1): once the
      //    new page's mirror has settled, his still mouse is looked up again ONCE — the arrow is
      //    back on the element under his cursor with no move (it used to stay gone until he moved)
      const qPath = `/q/${d.quote.id}`;
      await userPage.goto(`${baseUrl}${qPath}`);
      await until(
        "the stage mirrors the quote page",
        async () =>
          (await page.locator(FRAME).getAttribute("data-path")) === qPath,
        25_000,
      );
      await d.mirrorAsTall("the quote page");
      await presenterOnItsNode(
        "REQ-538: after the customer's page change, his mouse still",
      );
      expect.eq(
        await page.locator("[data-cy='demo-pointer-absent']").count(),
        0,
        "REQ-538: the stage's \"isn't on their screen\" hint is gone once the arrow is back",
      );

      // 2. the customer reloads it: a new page load — REQ-538: once its mirror has settled the
      //    arrow is back on the same element with no move
      await userPage.reload();
      await userPage.locator("[data-cy='demo-status']").filter({
        hasText: "Connected",
      }).waitFor({ timeout: 20_000 });
      await until(
        "the stage mirrors the reloaded page, scrolled where the customer's is",
        async () => {
          if ((await page.locator(FRAME).getAttribute("data-path")) !== qPath) {
            return false;
          }
          const want = await userPage.evaluate(() => globalThis.scrollY);
          return Math.abs((await mirrorScrollTop(page)) - want) <= 1;
        },
        25_000,
      );
      await presenterOnItsNode(
        "REQ-538: after the customer's reload, his mouse still",
      );
      // the reloaded page's mirror has settled: the arrow stays, with no move
      await page.waitForTimeout(2_000);
      await presenterOnItsNode("once the mirror has settled");
      expect.eq(
        await ghostAt(page),
        null,
        "REQ-451: no ghost on the stage while the arrow is where he put it",
      );

      // 3. REQ-451 AMENDMENT (demo M1, cycle 3) — supersedes REQ-393's step: the arrow is what he
      //    pointed at. The customer scrolls; the mirror scrolls under his still cursor; the arrow
      //    rides with its element on their screen (never left over whatever comes under the
      //    spot), and the stage draws a faint ghost of it on that element in the frame
      const before = await pointerAt(userPage, "Hans");
      if (!before) throw new Error("no presenter arrow before the scroll");
      const meant = await underCustomer(userPage, before.x, before.y);
      const from = await userPage.evaluate(() => globalThis.scrollY);
      const to = from >= 250 ? from - 250 : from + 250;
      await userPage.evaluate((y) => globalThis.scrollTo(0, y), to);
      const after = await frameFollows(
        "the customer's scroll under the presenter's still mouse",
      );
      const delta = after - from;
      expect(Math.abs(delta) >= 200, `the customer's page scrolled (${delta})`);
      await until(
        `REQ-451: the presenter's arrow rides with its element (the page scrolled ${delta}px) and the stage's ghost is on it`,
        async () => {
          const at = await pointerAt(userPage, "Hans");
          if (!at) throw new Error("no presenter arrow");
          const shown = await underCustomer(userPage, at.x, at.y);
          const now = await underMirror(page, rest.x, rest.y);
          const moved = before.y - at.y;
          const ghost = await ghostAt(page);
          const ghostOn = ghost
            ? await underMirror(
              page,
              d.toFrame(ghost).x,
              d.toFrame(ghost).y,
            )
            : null;
          if (
            at.outside || shown !== meant || Math.abs(moved - delta) > 3 ||
            !ghost || ghost.outside || ghostOn !== meant
          ) {
            throw new Error(
              `arrow ${JSON.stringify(at)} on ${shown} (before the scroll ${
                JSON.stringify(before)
              } on ${meant}; moved ${moved} for a ${delta}px scroll); under his cursor the mirror has ${now}; ghost ${
                JSON.stringify(ghost)
              } on ${ghostOn}`,
            );
          }
          return true;
        },
        8_000,
      );

      // 4. End from the customer (it asks first) clears both
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
    } finally {
      await d.userCtx.close();
    }
  }));
