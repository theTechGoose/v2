/**
 * REQ-228 — the demo pills never cover the page (demo issue pointer-and-replica-side-effects-m4).
 * A super admin opens a demo on a customer. On the customer's screen — a desktop window, then a
 * phone-size one — no link, button or field of the page has the pill on top of it: the topmost
 * thing at the middle of every visible control is the control, never the pill. On a narrow staff
 * window with a phone-size customer, the stage's pill sits below the frame, not over it.
 *
 * REQ-295 (demo-loop cycle 1, M1) — nor any TEXT of the page: no visible text node's middle has
 * the pill on top. A full reload of the same page puts the pill back in the same spot (no hop),
 * and the stage draws the pill's ghost inside the frame.
 *
 * REQ-372 (demo-loop cycle 2, m1 + m8) — the ghost is not an empty dashed box: it carries the
 * pill's status (in the presenter's words), and on the phone it stays inside the phone frame.
 *
 * REQ-540 (demo-loop cycle 4, m9) — the ghost says the whole pill: the "Demo mode" title, the
 * line, the status and End (a disabled chip), word for word as on the customer's pill.
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

/**
 * REQ-295 — the page's visible text whose middle has the demo pill on top (evaluated in the page).
 * REQ-440 (cycle 3, m2) — text that has scrolled into the pill's band is under the band's opaque
 * paint, not shown: it is not covered by the pill.
 */
const coveredText = () => {
  const out: string[] = [];
  const band = document.querySelector("[data-cy='demo-band']")
    ?.getBoundingClientRect();
  const bandTop = band && band.height > 0 ? band.top : Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("[data-demo-overlay],script,style,noscript")) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    if (y >= bandTop) continue;
    const top = document.elementFromPoint(x, y);
    if (top?.closest("[data-cy='demo-pill']")) {
      out.push(`"${text.slice(0, 30)}" @${Math.round(x)},${Math.round(y)}`);
    }
  }
  return out;
};

/** the page's visible controls whose middle has the demo pill on top (evaluated in the page) */
const coveredControls = () => {
  const sel =
    'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"]';
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (el.closest("[data-demo-overlay]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (top?.closest("[data-cy='demo-pill']")) {
      out.push(
        `${el.tagName.toLowerCase()} "${
          (el.textContent ?? "").trim().slice(0, 30)
        }" @${Math.round(x)},${Math.round(y)}`,
      );
    }
  }
  return out;
};

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 8_000,
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
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

Deno.test("REQ-228 + REQ-291: the customer's demo pill covers no control of the page, on a desktop and on a phone; the stage's pill stays below the frame on a narrow staff window and on one line at 1440 px", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 760, height: 700 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    // REQ-545 (cycle 4, m2) AMENDMENT — onboarded, so the demo finds the app's shell (which
    // subtracts the band), not the wizard, whose content under the home tucks the pill to its tab
    await answerQuestions(http, user.auth, {
      name: "Ana Torres",
      businessName: "Torres Plumbing",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      // REQ-294 — a long name, the demo's "Alex from DocuMonster"
      body: JSON.stringify({ language: "en", name: "Hans from DocuMonster" }),
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
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

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
      await userPage.reload();
      await pillUp(userPage);
      // REQ-232 — the stage's pill says Live once the customer's tab is on the link
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });

      // 1. desktop: no control and no text of the customer's page sits under the pill
      await until("desktop: the pill covers no control", async () => {
        const c = await userPage.evaluate(coveredControls);
        return c.length ? c.join("; ") : null;
      });
      await until("desktop: the pill covers no text (REQ-295)", async () => {
        const c = await userPage.evaluate(coveredText);
        return c.length ? c.join("; ") : null;
      });

      // 1b. REQ-295 — a full reload of the same page. REQ-781 (demo-loop cycle dv1, d7)
      // AMENDMENT — the pill floats where nothing (else no control) of the page is under it, so
      // its spot follows the page, not a fixed home: after a reload it again covers no control
      await userPage.reload();
      await pillUp(userPage);
      await until("after a reload the pill covers no control", async () => {
        const c = await userPage.evaluate(coveredControls);
        return c.length ? c.join("; ") : null;
      });

      // 1c. REQ-295 — the stage shows the pill's ghost inside the frame
      await until(
        "the stage draws the pill's ghost inside the frame",
        async () => {
          const r = await page.evaluate(() => {
            const box = (s: string) =>
              document.querySelector(s)?.getBoundingClientRect() ?? null;
            const frame = box("[data-cy='demo-stage-layer']");
            const ghost = box("[data-cy='demo-pill-ghost']");
            return frame && ghost
              ? {
                inside: ghost.left >= frame.left - 1 &&
                  ghost.top >= frame.top - 1 &&
                  ghost.right <= frame.right + 1 &&
                  ghost.bottom <= frame.bottom + 1,
                ghost: [ghost.left, ghost.top, ghost.width, ghost.height],
              }
              : null;
          });
          if (!r) return "no frame or ghost yet";
          return r.inside ? null : `ghost outside the frame: ${r.ghost}`;
        },
      );
      // REQ-372 (cycle 2, m1): and it says what the pill says
      await until("the ghost carries the pill's status", async () => {
        const said = await page.locator("[data-cy='demo-pill-ghost-status']")
          .first().textContent().catch(() => "");
        return (said ?? "").trim() === "Connected"
          ? null
          : `ghost status "${said}"`;
      });
      // REQ-540 (cycle 4, m9): the ghost says the WHOLE pill, word for word and in order —
      // "Demo mode · Hans … is guiding you · Connected · End demo", End as a disabled chip
      await until(
        "the ghost carries the whole pill's copy (REQ-540)",
        async () => {
          const g = await page.evaluate(() => {
            const q = (s: string) =>
              document.querySelector(s)?.textContent?.trim() ?? "";
            return {
              all: (document.querySelector("[data-cy='demo-pill-ghost']")
                ?.textContent ?? "").replace(/\s+/g, " ").trim(),
              title: q("[data-cy='demo-pill-ghost-title']"),
              end: q("[data-cy='demo-pill-ghost-end']"),
              endDisabled: document.querySelector(
                "[data-cy='demo-pill-ghost-end']",
              )?.getAttribute("aria-disabled") === "true",
            };
          });
          const pill = (await userPage.locator("[data-cy='demo-pill']")
            .innerText()).replace(/\s+/g, " ").trim();
          const want = [
            "Demo mode",
            "Hans from DocuMonster is guiding you",
            "Connected",
            "End demo",
          ];
          for (const w of want) {
            if (
              !pill.includes(w)
            ) return `the pill itself lacks "${w}": "${pill}"`;
          }
          let at = 0;
          for (const w of want) {
            const i = g.all.indexOf(w, at);
            if (i < 0) return `the ghost lacks "${w}" (in order): "${g.all}"`;
            at = i + w.length;
          }
          if (g.title !== "Demo mode") return `ghost title "${g.title}"`;
          if (g.end !== "End demo" || !g.endDisabled) {
            return `ghost End "${g.end}" (disabled: ${g.endDisabled})`;
          }
          return null;
        },
      );

      // 2. phone size: still one line, still covering no control. REQ-781 (demo-loop cycle dv1,
      // d7) AMENDMENT — no band is kept on the phone either, so where no spot is clear the pill
      // (or its mini-pill) floats over text, never over a control; checked as placed, with the
      // pointer off it (a pointer on the mini-pill shows the whole pill out of it)
      await userPage.setViewportSize({ width: 390, height: 844 });
      await pillUp(userPage);
      await userPage.mouse.move(195, 120);
      await until("phone: the pill covers no control", async () => {
        const c = await userPage.evaluate(coveredControls);
        return c.length ? c.join("; ") : null;
      });
      await pillUp(userPage);
      const pillH = await userPage.locator("[data-cy='demo-pill']").evaluate(
        (el) => el.getBoundingClientRect().height,
      );
      expect(pillH <= 48, `the phone pill is one line (${pillH}px tall)`);

      // REQ-294 (demo m21): tapped, the phone pill says who is guiding — the full name, no
      // "Demo mode" title in the way, and nothing cut to an ellipsis
      await userPage.locator("[data-cy='demo-more']").click();
      await userPage.locator("[data-cy='demo-details']").waitFor({
        timeout: 5_000,
      });
      const details = await userPage.locator("[data-cy='demo-details']")
        .evaluate((el) => {
          const clipped = [el, ...el.querySelectorAll("span")]
            .filter((n) => n.scrollWidth > n.clientWidth + 1)
            .map((n) => (n.textContent ?? "").trim());
          return {
            text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
            clipped,
            width: el.getBoundingClientRect().width,
          };
        });
      expect(
        details.text.includes("Hans from DocuMonster is guiding you"),
        `the opened phone pill names the guide in full — "${details.text}"`,
      );
      expect(
        !details.text.includes("Demo mode"),
        `the phone pill drops the "Demo mode" title — "${details.text}"`,
      );
      expect.eq(
        details.clipped.join(" | "),
        "",
        "nothing in the opened phone pill is cut",
      );
      await userPage.screenshot({ path: `${folder}/phone-pill-open.png` });
      await userPage.locator("[data-cy='demo-more']").click();

      // 3a. REQ-372 (cycle 2, m1 + m8): on the phone the ghost stays in the frame and says
      //     the pill's status — not an empty dashed box hanging off the frame's right edge
      await until(
        "phone: the ghost is a replica inside the frame",
        async () => {
          const r = await page.evaluate(() => {
            const box = (s: string) =>
              document.querySelector(s)?.getBoundingClientRect() ?? null;
            const frame = box("[data-cy='demo-stage-layer']");
            const ghost = box("[data-cy='demo-pill-ghost']");
            const status = document.querySelector(
              "[data-cy='demo-pill-ghost-status']",
            )?.textContent?.trim() ?? "";
            return frame && ghost
              ? {
                frameW: frame.width,
                inside: ghost.left >= frame.left - 1 &&
                  ghost.top >= frame.top - 1 &&
                  ghost.right <= frame.right + 1 &&
                  ghost.bottom <= frame.bottom + 1,
                ghost: [ghost.left, ghost.right, frame.left, frame.right],
                status,
              }
              : null;
          });
          if (!r) return "no frame or ghost yet";
          if (
            r.frameW > 380
          ) return `the frame is not the phone yet (${r.frameW}px)`;
          if (!r.inside) return `ghost outside the frame: ${r.ghost}`;
          return r.status === "Connected"
            ? null
            : `the ghost says "${r.status}", not the pill's status`;
        },
      );

      // 3. the stage, narrow, following the phone: the pill is below the frame
      await until("the stage pill is below the frame", async () => {
        const r = await page.evaluate(() => {
          const box = (s: string) =>
            document.querySelector(s)?.getBoundingClientRect() ?? null;
          const frame = box("[data-cy='demo-stage-layer']");
          const pill = box("[data-cy='demo-pill']");
          return frame && pill
            ? {
              frameBottom: frame.bottom,
              frameW: frame.width,
              pillTop: pill.top,
            }
            : null;
        });
        if (!r) return "no frame or pill yet";
        if (r.frameW > 380) {
          return `the frame is not the phone yet (${r.frameW}px)`;
        }
        return r.pillTop >= r.frameBottom
          ? null
          : `pill top ${r.pillTop} above frame bottom ${r.frameBottom}`;
      });

      // 4. REQ-291 (demo issue p14, cycle 1): a wide stage holds the whole pill on one line,
      //    centred — `left:50%` used to cap its width at half the window and wrap "End demo"
      await page.setViewportSize({ width: 1440, height: 900 });
      await until("the stage pill is one line at 1440 px", async () => {
        const r = await page.evaluate(() => {
          const el = document.querySelector("[data-cy='demo-pill']");
          if (!el) return null;
          const b = el.getBoundingClientRect();
          // one line: every child shares the same vertical centre (align-items:center)
          const rows = new Set(
            Array.from(el.children, (c) => {
              const r = c.getBoundingClientRect();
              return Math.round((r.top + r.bottom) / 2);
            }),
          );
          return {
            rows: rows.size,
            w: b.width,
            left: b.left,
            right: innerWidth - b.right,
          };
        });
        if (!r) return "no pill yet";
        if (r.rows > 1) {
          return `the pill's items sit on ${r.rows} lines — it wrapped`;
        }
        if (r.w <= 720) {
          return `pill is only ${r.w}px wide — still half the window`;
        }
        return Math.abs(r.left - r.right) < 2
          ? null
          : `pill is off centre (left ${r.left}, right ${r.right})`;
      });

      // REQ-235 — End asks first
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));
