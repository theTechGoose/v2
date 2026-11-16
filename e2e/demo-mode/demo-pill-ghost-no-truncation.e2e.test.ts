/**
 * REQ-865 (demo-loop cycle dm4, issue p1) — the stage's ghost of the customer's pill never cuts
 * words the customer sees whole.
 *
 * At 1280 and 700 wide, with End's question up, the customer's pill read "Demo mode · Alex is
 * guiding you · Connected · End the demo with Alex? · Yes, end it · Keep going" while the stage's
 * ghost drew "Alex is guiding y…" and "End the demo with Al…" (scrollWidth 134 > clientWidth 132),
 * in EN and in ES. The ghost's box was the customer's box × the frame's scale, but its insides
 * were rebuilt with other metrics (a 1.5 px layout border, a narrower status chip padding at a
 * larger font, End as a 1px 5px chip) — a few px short once End's question was up.
 *
 * A super admin opens a demo on Ana (1280×800, in `lang`). Ana taps End: her pill asks. On the
 * stage, every element of the ghost has scrollWidth ≤ clientWidth (her own pill's words are whole,
 * checked first). Her window then narrows to 700 (still above the compact pill) with the question
 * still up: the same holds.
 *
 * REQ-871 (demo-loop cycle dm5, issue p1) — and at REST, the pill every tester looks at ("Demo
 * mode · Alex is guiding you · Connected · End demo"). REQ-865's story only measured the asking
 * pill; the resting ghost still read "Alex is guiding y…" (scrollWidth 116 > clientWidth 115)
 * because `pillRestBox` sent her width ROUNDED: a pill whose natural width has a fraction under .5
 * (presenters Ana, Maria, Jo, Alex — which name it is depends on the host's fonts) came to the
 * stage up to half a pixel short, and the ghost's text span took the deficit with an ellipsis.
 * For each presenter name, in EN and ES, at 1280 and 700, with her resting pill shown whole (the
 * pointer on its folded tab), the ghost says the same "… is guiding you" as her pill, and no
 * element of it is cut.
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

async function setMe(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  language: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name }),
  })).body?.cancel();
}

async function useCookie(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  baseUrl: string,
  cookie: string,
  lang: string,
) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
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

/** every element under `root` whose words overflow it (scrollWidth > clientWidth) */
const cutIn = (sel: string) => {
  const root = document.querySelector<HTMLElement>(sel);
  if (!root) return null;
  const cut: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth) {
      cut.push(
        `${el.dataset.cy ?? el.tagName} "${
          (el.textContent ?? "").trim()
        }" ${el.scrollWidth}>${el.clientWidth}`,
      );
    }
  }
  return {
    asking: root.querySelector(
      "[data-cy='demo-end-ask'], [data-cy='demo-pill-ghost-ask']",
    ) !== null,
    text: (root.textContent ?? "").replace(/\s+/g, " ").trim(),
    vw: innerWidth,
    cut,
  };
};

/** a screenshot, best effort: a busy host's capture error never hides the real failure */
// deno-lint-ignore no-explicit-any
const snap = async (p: any, o: { path: string }) => {
  await p.screenshot(o).catch(() => {});
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-865 (demo-loop cycle dm4, p1): ${lang.toUpperCase()} — with End's question up at 1280 and 700, no word of the stage's ghost of the customer's pill is cut (scrollWidth ≤ clientWidth), as none of hers is`, (t) =>
    story(t, async ({ page, expect, http, baseUrl, folder }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const userPhone = `+1512${digits()}`;
      const adminPhone = `+1843${digits()}`;
      const user = await verify(http, userPhone);
      await setMe(http, user.auth, "Ana Torres", lang);
      const admin = await verify(http, adminPhone);
      await setMe(http, admin.auth, "Alex", "en");
      const boot = await http("/api/admin/bootstrap", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ phoneNumber: adminPhone }),
      });
      expect.eq(boot.status, 200, "Alex is a super admin");
      await boot.body?.cancel();
      await useCookie(page.context(), baseUrl, admin.cookie, "en");

      const browser = page.context().browser();
      if (!browser) throw new Error("no browser behind the story page");
      const userCtx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      try {
        const userPage = await userCtx.newPage();
        await useCookie(userCtx, baseUrl, user.cookie, lang);
        await userPage.goto(`${baseUrl}/customers`);

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
        await until("the customer's pill says Connected", async () => {
          const s = await userPage.locator("[data-cy='demo-pill']")
            .getAttribute("data-status").catch(() => null);
          return s === "live" ? null : `status ${s}`;
        }, 25_000);
        await page.locator("[data-cy='demo-pill-ghost']").waitFor({
          state: "attached",
          timeout: 15_000,
        });

        // Ana taps End (the whole pill's, or its mini-pill's ×): her pill asks
        const folded = await userPage.locator("[data-cy='demo-pill-tab-end']")
          .isVisible().catch(() => false);
        await userPage.locator(
          folded
            ? "[data-cy='demo-pill-tab-end']"
            : "[data-cy='demo-pill'] [data-cy='demo-end']",
        ).click();
        await userPage.locator(
          "[data-cy='demo-pill'] [data-cy='demo-end-ask']",
        ).waitFor({ state: "visible", timeout: 5_000 });

        const whole = async (tag: string, vw: number) => {
          await userPage.waitForTimeout(600); // past the glide (PILL_MOVE_MS)
          let seen = "";
          // her own pill's words are whole (the precondition: nothing to cut on the stage)
          await until(
            `${tag}: the customer's asking pill is whole`,
            async () => {
              const c = await userPage.evaluate(cutIn, "[data-cy='demo-pill']");
              seen = JSON.stringify(c);
              return c && c.asking && c.vw === vw && c.cut.length === 0
                ? null
                : seen;
            },
            8_000,
          );
          const customer = seen;
          // and the stage's ghost of it cuts none of them
          await until(
            `${tag}: no word of the stage's ghost is cut (customer ${customer})`,
            async () => {
              const g = await page.evaluate(
                cutIn,
                "[data-cy='demo-pill-ghost']",
              );
              seen = JSON.stringify(g);
              return g && g.asking && g.cut.length === 0 ? null : seen;
            },
            10_000,
          ).catch(async (e) => {
            await snap(page, {
              path: `${folder}/${lang}-${tag}-stage-RED.png`,
            });
            await snap(userPage, {
              path: `${folder}/${lang}-${tag}-customer-RED.png`,
            });
            throw e;
          });
          await snap(page, { path: `${folder}/${lang}-${tag}-stage.png` });
          await snap(userPage, {
            path: `${folder}/${lang}-${tag}-customer.png`,
          });
        };

        await whole("w1280", 1280);
        // 700: narrower, still the one-row desktop pill (above PILL_COMPACT_MAX_W), question up
        await userPage.setViewportSize({ width: 700, height: 800 });
        await whole("w700", 700);
      } finally {
        await userCtx.close();
      }
    }));
}

/** REQ-871 — a super admin named `guide` presents to Sam (1280×800, in `lang`); `body` runs on both pages */
async function presenting(
  // deno-lint-ignore no-explicit-any
  tools: any,
  lang: "en" | "es",
  guide: string,
  // deno-lint-ignore no-explicit-any
  body: (stage: any, userPage: any) => Promise<void>,
) {
  const { page, expect, http, baseUrl } = tools;
  await page.setViewportSize({ width: 1280, height: 800 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await setMe(http, user.auth, "Sam Lee", lang);
  const admin = await verify(http, adminPhone);
  await setMe(http, admin.auth, guide, "en");
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  expect.eq(boot.status, 200, `${guide} is a super admin`);
  await boot.body?.cancel();
  await useCookie(page.context(), baseUrl, admin.cookie, "en");
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  try {
    const userPage = await userCtx.newPage();
    await useCookie(userCtx, baseUrl, user.cookie, lang);
    await userPage.goto(`${baseUrl}/customers`);
    await page.goto(`${baseUrl}/admin`);
    await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='adm-demo']").first().click();
    await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });
    await until("the customer's pill says Connected", async () => {
      const s = await userPage.locator("[data-cy='demo-pill']")
        .getAttribute("data-status").catch(() => null);
      return s === "live" ? null : `status ${s}`;
    }, 25_000);
    await body(page, userPage);
  } finally {
    await userCtx.close();
  }
}

const GUIDING = { en: "is guiding you", es: "te está guiando" } as const;

for (const lang of ["en", "es"] as const) {
  for (const guide of ["Ana", "Maria", "Jo", "Alex"]) {
    Deno.test(
      `REQ-871 (demo-loop cycle dm5, p1): ${lang.toUpperCase()} — presenter "${guide}": at rest, at 1280 and 700, the stage's ghost says "${guide} ${
        GUIDING[lang]
      }" whole (scrollWidth ≤ clientWidth), as her pill does`,
      (t) =>
        story(t, async (tools) => {
          await presenting(tools, lang, guide, async (page, userPage) => {
            const phrase = `${guide} ${GUIDING[lang]}`;
            /** the pointer on her folded tab shows the whole pill and holds it (REQ-545 / REQ-820) */
            const hold = async () => {
              const tab = userPage.locator("[data-cy='demo-pill-tab']");
              if (await tab.isVisible().catch(() => false)) {
                await tab.hover({ timeout: 2_000 }).catch(() => {});
              }
            };
            const whole = async (tag: string, vw: number) => {
              await userPage.waitForTimeout(600); // past the glide (PILL_MOVE_MS)
              let seen = "";
              // her resting pill says "<guide> is guiding you" and its words are whole. Folded to
              // its mini-pill after the join (REQ-545), the pointer on the tab shows it whole and
              // holds it there (REQ-820), as a tester does
              await until(
                `${tag}: the customer's resting pill says "${phrase}" whole`,
                async () => {
                  await hold();
                  const c = await userPage.evaluate(
                    cutIn,
                    "[data-cy='demo-pill']",
                  );
                  seen = JSON.stringify(c);
                  return c && !c.asking && c.vw === vw &&
                      c.text.includes(phrase) && c.cut.length === 0
                    ? null
                    : seen;
                },
                15_000,
              );
              const customer = seen;
              await until(
                `${tag}: the stage's resting ghost says "${phrase}" and cuts no word (customer ${customer})`,
                async () => {
                  // the pointer stays on her pill (a resize can leave it on the page: re-hover)
                  await hold();
                  const g = await page.evaluate(
                    cutIn,
                    "[data-cy='demo-pill-ghost']",
                  );
                  seen = JSON.stringify(g);
                  return g && !g.asking && g.text.includes(phrase) &&
                      g.cut.length === 0
                    ? null
                    : seen;
                },
                10_000,
              );
            };
            await whole("w1280", 1280);
            await userPage.setViewportSize({ width: 700, height: 800 });
            await whole("w700", 700);
          });
        }),
    );
  }
}
