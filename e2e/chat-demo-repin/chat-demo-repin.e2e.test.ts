/**
 * REQ-469 — demo-loop cycle 3, issue m39 ("'Lock it in' / 'Edit' half hidden
 * behind the message box at 1280×720", pair 5): the contractor sits on
 * /assistant with a drafted quote card at the bottom of the chat when a super
 * admin starts a demo on them. The demo reserves the pill's band (REQ-379,
 * --demo-pill-h), the app's shell — and so the chat's scroller — gets shorter,
 * and the chat used to stay where it was: the card's Lock it in / Edit sat
 * under the composer. Now the chat stays pinned to its bottom when its scroller
 * shrinks, so both buttons are whole above the composer.
 *
 * A draft action_card only comes out of the LLM's create_quote, so (like
 * REQ-246's story) the page's one load of the conversation is answered with the
 * conversation plus a draft quote card.
 *
 * Page: front-end/routes/assistant/index.tsx (island
 * front-end/islands/AsstChat.tsx, pin in front-end/lib/chat-bottom-pin.ts).
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

/** where the card's buttons are against the chat's visible area and the composer */
const buttonsBox = () => {
  const card = [...document.querySelectorAll<HTMLElement>(".action-card")]
    .find((c) => (c.textContent ?? "").includes("Tile install"));
  const btns = card
    ? [...card.querySelectorAll<HTMLElement>(".action-card__cta button")]
    : [];
  const scroller = document.querySelector<HTMLElement>(".chat__scroll");
  const composer = document.querySelector<HTMLElement>(".composer");
  const band = getComputedStyle(document.documentElement).getPropertyValue(
    "--demo-pill-h",
  ).trim();
  const vis = scroller?.getBoundingClientRect() ?? null;
  return {
    labels: btns.map((b) => (b.textContent ?? "").trim()),
    bottoms: btns.map((b) => Math.round(b.getBoundingClientRect().bottom)),
    tops: btns.map((b) => Math.round(b.getBoundingClientRect().top)),
    visTop: vis ? Math.round(vis.top) : null,
    visBottom: vis ? Math.round(vis.bottom) : null,
    composerTop: composer
      ? Math.round(composer.getBoundingClientRect().top)
      : null,
    band,
  };
};
type Box = ReturnType<typeof buttonsBox>;

/** both buttons whole inside the chat's visible area, above the composer */
const whole = (b: Box) =>
  b.labels.length === 2 && b.visBottom !== null && b.composerTop !== null &&
  b.bottoms.every((y) => y <= b.visBottom! && y <= b.composerTop!) &&
  b.tops.every((y) => y >= b.visTop!);

Deno.test("REQ-469 (demo m39, cycle 3): a demo starting while a draft quote card sits at the bottom of /assistant at 1280×720 keeps Lock it in and Edit whole above the composer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await answerQuestions(http, user.auth, {
      name: "Ana Pinto",
      businessName: "Pinto Tile Works",
    });
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();
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

    const res = await http("/api/agents/conversations", {
      method: "POST",
      headers: user.auth,
      body: "{}",
    });
    const conversation = await res.json();
    const id = conversation.id as string;
    const now = Date.now();
    // a conversation long enough to scroll, ending in the draft quote card
    const history = Array.from({ length: 6 }, (_, i) => [
      {
        id: `m-u${i}`,
        conversationId: id,
        role: "user",
        kind: "text",
        content: `Bathroom tile, question ${
          i + 1
        }: what about the shower niche?`,
        createdAt: now - 60_000 + i * 2000,
      },
      {
        id: `m-a${i}`,
        conversationId: id,
        role: "assistant",
        kind: "text",
        content:
          "Got it — I'll keep the niche in the tile line, porcelain, 80 sqft, two days for a crew of two.",
        createdAt: now - 59_000 + i * 2000,
      },
    ]).flat();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();
      await userPage.route(
        `**/api/agents/conversations/${id}`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              conversation,
              messages: [
                ...history,
                {
                  id: "m-card",
                  conversationId: id,
                  role: "assistant",
                  kind: "action_card",
                  content: "Quote drafted",
                  createdAt: now - 1000,
                  payload: {
                    actionType: "quote",
                    status: "draft",
                    quoteId: "q-req469",
                    lineItems: [
                      { description: "Tile install", amountCents: 100000 },
                      { description: "Materials", amountCents: 20000 },
                      { description: "Shower niche", amountCents: 15000 },
                    ],
                    totalCents: 135000,
                  },
                },
              ],
            }),
          }),
      );
      await userPage.goto(`${baseUrl}/assistant?c=${id}`);
      await userPage.locator(".action-card", { hasText: "Tile install" })
        .waitFor({ state: "visible", timeout: 20_000 });

      // before the demo: the card's buttons are whole (the chat sits at its bottom)
      let before: Box = await userPage.evaluate(buttonsBox);
      for (let i = 0; i < 50; i++) {
        before = await userPage.evaluate(buttonsBox);
        if (whole(before)) break;
        await userPage.waitForTimeout(200);
      }
      expect(
        whole(before),
        `precondition: Lock it in and Edit whole before the demo ${
          JSON.stringify(before)
        }`,
      );

      // the super admin starts a demo on this contractor
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.setViewportSize({ width: 1280, height: 800 });
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

      // the contractor's app joins on its own (its poll) and reserves the band
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "visible",
        timeout: 30_000,
      });
      let band = "";
      for (let i = 0; i < 100 && !/[1-9]/.test(band); i++) {
        band = (await userPage.evaluate(buttonsBox)).band;
        if (!/[1-9]/.test(band)) await userPage.waitForTimeout(200);
      }
      expect(/[1-9]/.test(band), `the demo reserved its band ("${band}")`);

      // the chat settles (a smooth scroll runs for a moment), untouched by the person
      let after: Box = await userPage.evaluate(buttonsBox);
      let last = "";
      for (let i = 0; i < 20; i++) {
        await userPage.waitForTimeout(250);
        after = await userPage.evaluate(buttonsBox);
        const now = JSON.stringify(after);
        if (now === last) break;
        last = now;
      }
      expect(
        whole(after),
        `Lock it in and Edit are whole above the composer once the demo's band is reserved ${
          JSON.stringify(after)
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));
