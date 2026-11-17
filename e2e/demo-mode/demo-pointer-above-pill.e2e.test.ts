/**
 * REQ-831 — demo-loop cycle dm2 (run r9c47ba57), issue m4: "Customer's presenter arrow and click
 * wave are stacked below the demo pill". In two browsers: the admin ("Alex") on the stage, the
 * customer (1280×800) on /customers. The customer brings their pill out and clicks End, so End's
 * question ("End the demo with Alex?" — Yes, end it / Keep going) is open inside the pill. Alex
 * moves his mouse on the stage onto the customer's "Keep going". On the customer's screen his
 * arrow is drawn ABOVE the pill: hit-tested at a point of the arrow over the pill, the arrow comes
 * before demo-pill (and before demo-end-cancel / demo-end-ask). The tester's run had
 * elementsFromPoint(1217,771) = demo-end-cancel, demo-end-ask, demo-pill, FOOTER: no arrow on top.
 *
 * The arrow is pointer-events:none (it never takes a click), and so is the pill's empty area
 * (REQ-545, only its buttons take one); elementsFromPoint skips such layers, so the probe lets the
 * arrow's and the pill's subtrees be hit for the one measure (paint order is unchanged), then puts
 * them back.
 * Clicks still go to the pill's buttons: Keep going is clicked through the arrow at the end.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";
import { pillUp } from "../_shared/demo-pill.ts";

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

/** Alex's arrow tip on the customer's screen */
const tipOf = (n: string) => {
  const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
    .find((e) => e.getAttribute("data-presenter") === n);
  if (!el) return null;
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { x: m.m41, y: m.m42, off: el.hasAttribute("data-off") };
};

/**
 * The stacking at Alex's arrow: the arrow's and the pill's subtrees are let be hit for this one
 * measure (both pointer-events:none), then each point of its body is hit-tested. At the first point that
 * is over the pill, the order of the arrow, End's answer, End's question and the pill.
 */
const stackAt = (n: string) => {
  const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
    .find((e) => e.getAttribute("data-presenter") === n) as HTMLElement | null;
  if (!el) return null;
  const pill = document.querySelector("[data-cy='demo-pill']");
  const style = document.createElement("style");
  style.textContent =
    "[data-cy='demo-pointer'], [data-cy='demo-pointer'] *, [data-cy='demo-pill'], [data-cy='demo-pill'] * { pointer-events: auto !important; }";
  document.head.appendChild(style);
  try {
    const svg = el.querySelector("svg");
    const r = (svg ?? el).getBoundingClientRect();
    for (let dy = 4; dy < r.height; dy += 3) {
      for (let dx = 2; dx < r.width; dx += 2) {
        const x = r.left + dx;
        const y = r.top + dy;
        const hit = document.elementsFromPoint(x, y);
        const iOf = (sel: string) => hit.findIndex((e) => e.closest(sel));
        const arrow = hit.findIndex((e) => el.contains(e));
        const onPill = hit.findIndex((e) => e === pill);
        if (arrow < 0 || onPill < 0) continue;
        return {
          x,
          y,
          arrow,
          pill: onPill,
          cancel: iOf("[data-cy='demo-end-cancel']"),
          ask: iOf("[data-cy='demo-end-ask']"),
          z: Number(getComputedStyle(el).zIndex),
          pillZ: Number(getComputedStyle(pill as Element).zIndex),
          top: hit.slice(0, 6).map((e) =>
            e.getAttribute("data-cy") ?? e.tagName.toLowerCase()
          ),
        };
      }
    }
    return {
      none: true,
      box: { l: r.left, t: r.top, w: r.width, h: r.height },
    };
  } finally {
    style.remove();
  }
};

Deno.test("REQ-831 (demo-loop cycle dm2, m4): with End's question open on the customer's pill, the presenter's arrow over it is drawn above the pill — hit-tested, the arrow comes before demo-pill", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
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
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const view = { width: 1280, height: 800 };
    const userCtx = await browser.newContext({ viewport: view });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/customers`);

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

      // the customer's whole pill, its link up; End asks its question
      await pillUp(userPage, { live: true, timeout: 30_000 });
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end']")
        .click();
      const cancel = userPage.locator(
        "[data-cy='demo-pill'] [data-cy='demo-end-cancel']",
      );
      await cancel.waitFor({ state: "visible", timeout: 5_000 });
      // the asking pill glides to its spot (REQ-816/852), and a headless page ticks frames ~6 times
      // a second: Keep going's box is read once it is inside the window and still for 600 ms
      let kb = await cancel.boundingBox();
      for (let same = 0, i = 0; i < 30 && same < 3; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const now = await cancel.boundingBox();
        same = now && kb && Math.abs(now.x - kb.x) < 0.5 &&
            Math.abs(now.y - kb.y) < 0.5 && now.x + now.width <= view.width
          ? same + 1
          : 0;
        kb = now;
      }
      if (!kb) throw new Error("Keep going has no box");
      if (kb.x + kb.width > view.width) {
        throw new Error(
          `Keep going sits off the window: ${JSON.stringify(kb)}`,
        );
      }
      const goal = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };

      // Alex's mouse on the stage, onto the customer's Keep going (the frame maps the screens)
      const FRAME = "[data-cy='demo-frame']";
      await page.locator(FRAME).waitFor({ timeout: 20_000 });
      const fb = await page.locator(FRAME).boundingBox();
      if (!fb) throw new Error("no frame box");
      const s = fb.width / view.width;
      const at = { x: fb.x + goal.x * s, y: fb.y + goal.y * s };
      await page.mouse.move(at.x - 40, at.y - 20, { steps: 3 });
      await page.mouse.move(at.x, at.y, { steps: 3 });
      await until("Alex's arrow is on the customer's Keep going", async () => {
        const tip = await userPage.evaluate(tipOf, "Alex");
        if (
          !tip || tip.off || Math.abs(tip.x - goal.x) > 30 ||
          Math.abs(tip.y - goal.y) > 30
        ) {
          // a nudge: the stage reports moves, not a still mouse
          await page.mouse.move(at.x + 1, at.y, { steps: 1 });
          await page.mouse.move(at.x, at.y, { steps: 1 });
          return JSON.stringify({ tip, goal });
        }
        return null;
      }, 25_000);
      expect(
        await cancel.isVisible(),
        "End's question is still open in the pill",
      );
      // evidence only: a slow host must not fail the stacking check on a screenshot
      await userPage.screenshot({
        path: `${folder}/arrow-on-keep-going.png`,
        timeout: 15_000,
      }).catch(() => {});

      const seen = await userPage.evaluate(stackAt, "Alex");
      if (!seen || "none" in seen) {
        throw new Error(
          `no point of Alex's arrow is over the pill: ${JSON.stringify(seen)}`,
        );
      }
      expect(
        seen.arrow < seen.pill,
        `the arrow is drawn above the pill at (${seen.x}, ${seen.y}): z ${seen.z} vs the pill's ${seen.pillZ}; stack ${
          seen.top.join(", ")
        }`,
      );
      if (seen.cancel >= 0) {
        expect(
          seen.arrow < seen.cancel,
          `the arrow is above Keep going: ${seen.top.join(", ")}`,
        );
      }
      if (seen.ask >= 0) {
        expect(
          seen.arrow < seen.ask,
          `the arrow is above End's question: ${seen.top.join(", ")}`,
        );
      }

      // the arrow never takes a click: Keep going still answers, under it
      await userPage.mouse.click(goal.x, goal.y);
      await until("Keep going put End back", async () => {
        const open = await cancel.isVisible().catch(() => false);
        return open ? "End's question is still open" : null;
      }, 5_000);
    } finally {
      await userCtx.close();
    }
  }));
