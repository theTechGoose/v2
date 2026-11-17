/**
 * REQ-890 (demo-loop run 6, m1 + m2; by hand) — at 700×800 on /customers the customer's folded pill,
 * hovered, opened 250 px away from its tab over the page's text (EN) or over the filter chips (ES)
 * and folded under the pointer on its way there. Now a tab row with a control under every x
 * opens the COMPACT pill (name · status · End) flush with the tab, over no control, and the pill
 * stays whole while the pointer moves from the tab onto it; leaving folds it as before.
 *
 * Alexandra (a super admin) demos Ana, whose window is 700×800 on /customers.
 */
import { story, type StoryTools } from "#shots";

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

async function setName(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name }),
  })).body?.cancel();
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

type Box = { x: number; y: number; width: number; height: number };

/** the pill as laid out, whether it is the compact form, and the controls under its box */
const probe = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const tab = document.querySelector<HTMLElement>("[data-cy='demo-pill-tab']");
  const box = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const b = box(pill);
  const controls = new Set<Element>();
  if (b && pill) {
    for (let x = b.x + 3; x < b.x + b.width; x += 12) {
      for (let y = b.y + 3; y < b.y + b.height; y += 8) {
        const e = document.elementsFromPoint(x, y).find((n) =>
          !pill.contains(n)
        );
        const c = e?.closest(
          "button, a[href], input, select, textarea, summary, [role='button'], [role='tab']",
        );
        if (c) controls.add(c);
      }
    }
  }
  const text = pill?.textContent ?? "";
  // REQ-890 REVISION — what is under the flush peek box (the spot `peekBox` tries first: the
  // pill's width, its foot on the tab's foot, flush with the tab's right edge), for the failure
  // message: a crowded spot there sends the peek to another row
  const tb = box(tab);
  const flush: string[] = [];
  if (tb && b) {
    const fw = b.width;
    const fh = 43;
    const fx = tb.x + tb.width - fw;
    const fy = tb.y + tb.height - fh;
    const seen = new Set<Element>();
    for (let x = fx + 3; x < fx + fw; x += 12) {
      for (let y = fy + 3; y < fy + fh; y += 8) {
        const e = document.elementsFromPoint(x, y).find((n) =>
          !pill?.contains(n)
        );
        const c = e?.closest(
          "button, a[href], input, select, textarea, summary, [role='button'], [role='tab']",
        );
        if (c && !seen.has(c)) {
          seen.add(c);
          const r = c.getBoundingClientRect();
          flush.push(
            `${(c.textContent ?? "").trim().slice(0, 16)}@${
              Math.round(r.left)
            },${Math.round(r.top)} ${Math.round(r.width)}x${
              Math.round(r.height)
            }`,
          );
        }
      }
    }
  }
  return {
    pill: b,
    tab: tb,
    flush,
    fonts: document.fonts?.status ?? "?",
    folded: pill?.hasAttribute("data-tucked") ?? false,
    compact: pill?.hasAttribute("data-compact") ?? false,
    text: text.slice(0, 60),
    controls: [...controls].map((c) =>
      (c.textContent ?? "").trim().slice(0, 20)
    ),
  };
};

Deno.test("REQ-890 (run 6, m1+m2): at 700×800 on /customers the hovered tab opens the compact pill flush with the tab, over no control, and the pointer moving onto it does not fold it", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const admin = await verify(http, adminPhone);
    await setName(http, admin.auth, "Alexandra Whitfield");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "Alexandra is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 700, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/customers`);
      await useCookie(page.context(), baseUrl, admin.cookie);

      await page.goto(`${baseUrl}/admin`);
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
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 20_000 });
      // past the join grace: on this crowded page the pill folds to its tab
      await userPage.locator("[data-cy='demo-pill-tab']").waitFor({
        timeout: 15_000,
      });
      // REQ-890 REVISION — the lane's pacing (4 pages, ~6 fps): the chip is hovered only once
      // the page's fonts are in and its spot has held for 300 ms — a hover on a chip still on
      // its way to its spot opens the peek from where the chip was, under no pointer, and it
      // folds again (the 102-story lane: "compact 252,702" at 200 ms, folded at 400 ms)
      await userPage.evaluate(() => document.fonts?.ready);
      let folded = await userPage.evaluate(probe);
      for (let i = 0; i < 20; i++) {
        await userPage.waitForTimeout(300);
        const again = await userPage.evaluate(probe);
        if (
          again.folded && again.tab && folded.tab &&
          Math.round(again.tab.x) === Math.round(folded.tab.x) &&
          Math.round(again.tab.y) === Math.round(folded.tab.y)
        ) {
          folded = again;
          break;
        }
        folded = again;
      }
      expect(
        folded.folded && folded.tab !== null,
        `folded first: ${JSON.stringify(folded)}`,
      );
      const tab = folded.tab as Box;

      // a real pointer onto the tab, then along it
      await userPage.mouse.move(tab.x + 10, tab.y + tab.height / 2, {
        steps: 3,
      });
      await userPage.mouse.move(tab.x + 30, tab.y + tab.height / 2, {
        steps: 3,
      });
      // what the pill did over the next 2 s (for the failure message)
      const timeline: string[] = [];
      for (let i = 0; i < 10; i++) {
        await userPage.waitForTimeout(200);
        const p = await userPage.evaluate(probe);
        timeline.push(
          `${(i + 1) * 200}ms ${
            p.folded ? "folded" : p.compact ? "compact" : "whole"
          } ${
            p.pill
              ? `${Math.round(p.pill.x)},${Math.round(p.pill.y)} w${
                Math.round(p.pill.width)
              }`
              : "-"
          } controls=${p.controls.length} flush=[${
            p.flush.join(" ")
          }] fonts=${p.fonts}`,
        );
      }
      const open = { ...(await userPage.evaluate(probe)), timeline };
      await userPage.screenshot({ path: `${folder}/peek-open.png` });
      expect(
        !open.folded && open.pill !== null,
        `the pill is out: ${JSON.stringify(open)}`,
      );
      const pill = open.pill as Box;
      expect(
        open.compact,
        `the crowded row shows the compact pill (no "Demo mode" title): ${
          JSON.stringify(open)
        }`,
      );
      // on the tab's row, or (REQ-873: a control's edge on that row — "Export customers" ends
      // 3 px into it here) the next clear row, one pill height plus the band's gap away; never
      // 250 px off across the page
      const feet = Math.abs(pill.y + pill.height - (tab.y + tab.height));
      expect(
        feet <= pill.height + 8 + 1,
        `on the tab's row or the row next to it (feet ${feet} px apart): pill ${
          JSON.stringify(pill)
        } tab ${JSON.stringify(tab)}`,
      );
      // flush with the tab's edge: the pill reaches the tab's x-range
      expect(
        pill.x + pill.width >= tab.x + 8 && pill.x <= tab.x + tab.width,
        `flush with the tab: pill ${JSON.stringify(pill)} tab ${
          JSON.stringify(tab)
        }`,
      );
      expect(
        open.controls.length === 0,
        `no control under it: ${JSON.stringify(open.controls)}`,
      );

      // the pointer travels from the tab onto the pill: it stays whole
      const cx = pill.x + pill.width / 2;
      const cy = pill.y + pill.height / 2;
      await userPage.mouse.move(cx, cy, { steps: 8 });
      await userPage.waitForTimeout(800);
      const reached = await userPage.evaluate(probe);
      expect(
        !reached.folded && reached.compact,
        `still out, still compact, with the pointer on it: ${
          JSON.stringify(reached)
        }`,
      );

      // leaving folds it again (REQ-545), and the whole form is back for the next peek
      await userPage.mouse.move(650, 60, { steps: 6 });
      await userPage.locator("[data-cy='demo-pill-tab']").waitFor({
        timeout: 5_000,
      });
      const again = await userPage.evaluate(probe);
      expect(
        again.folded,
        `folded after the pointer left: ${JSON.stringify(again)}`,
      );
    } finally {
      await userCtx.close();
    }
  }));
