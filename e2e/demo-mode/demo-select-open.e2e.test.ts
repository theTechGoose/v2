/**
 * REQ-638 (demo-loop cycle 5, M11) — an open dropdown list is shown on the stage.
 *
 * 1. A native <select> (pair 4's "Payment terms"): Chrome draws its open list outside the DOM,
 *    so the mirror carried only the value and the stage showed a closed "Net 30" while the
 *    customer chose. In a real Chromium, the customer's real recorder streams its document into
 *    the stage's real replayer (MIRROR_SRCDOC's sandboxed frame): clicking the select draws a
 *    listbox of its options under it on the stage within 1 s; a pick closes it and the stage
 *    shows the new value; clicking elsewhere closes it too.
 * 2. The app's own "Choose how to send" menu (pair 2): plain DOM. During a real demo the
 *    customer opens the ▾ send caret on a quote review and the stage's frame holds
 *    `.quote-review__send-menu` within 1 s (the RCA asked for this check before any fix).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const ROOT = new URL("../../", import.meta.url);

/** the customer's recorder and the stage's replayer, bundled for the browser as `window.__mm` */
async function mirrorBundle(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const entry = `${dir}/entry.ts`;
  const lib = (p: string) =>
    JSON.stringify(new URL(`front-end/lib/demo-mode/${p}`, ROOT).href);
  await Deno.writeTextFile(
    entry,
    `import * as rec from ${lib("mirror-record.ts")};\n` +
      `import * as rep from ${lib("mirror-replay.ts")};\n` +
      `(globalThis as unknown as { __mm: unknown }).__mm = { rec, rep };\n`,
  );
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--quiet", "--platform", "browser", "--no-check", entry],
    cwd: new URL(".", ROOT).pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(dir, { recursive: true });
  if (!out.success) {
    throw new Error(`deno bundle: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout);
}

type Page = StoryTools["page"];

/** polls `fn` (in the page) every 50 ms for `ms`: the first truthy answer, or the last one */
async function within<T>(page: Page, ms: number, fn: () => T): Promise<T> {
  const t0 = Date.now();
  let v = await page.evaluate(fn);
  while (!v && Date.now() - t0 < ms) {
    await page.waitForTimeout(50);
    v = await page.evaluate(fn);
  }
  return v;
}

Deno.test("REQ-638 (cycle 5, M11): a native select opened by the customer is drawn open on the stage within 1 s, with its options, and closes on a pick or a click elsewhere", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 900, height: 700 });
    // any page of the app's origin: the stage frame is same-origin with it
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.innerHTML =
        `<div style="padding:40px;font:16px sans-serif">` +
        `<label>Payment terms <select id="terms">` +
        `<option value="now">Due now</option>` +
        `<option value="net30" selected>Net 30</option>` +
        `<option value="net60">Net 60</option></select></label>` +
        `<button id="save" type="button" style="margin-left:40px">Save</button></div>` +
        // the stage, on the same page: never recorded (the overlay is never mirrored)
        `<div data-demo-overlay style="position:fixed;right:0;top:0">` +
        `<iframe id="stage" sandbox="allow-same-origin" ` +
        `style="width:420px;height:300px;border:1px solid #999"></iframe></div>`;
      // deno-lint-ignore no-explicit-any
      const mm = (globalThis as any).__mm;
      const f = document.getElementById("stage") as HTMLIFrameElement;
      const loaded = new Promise((r) => f.addEventListener("load", r));
      f.srcdoc = mm.rep.MIRROR_SRCDOC;
      await loaded;
      const replay = mm.rep.createReplayer(f.contentDocument!);
      const recorder = mm.rec.createRecorder(document, {
        emit: (fr: unknown) => replay.apply(JSON.parse(JSON.stringify(fr))),
      });
      recorder.snapshot();
    });
    const stageList = () => {
      const d = (document.getElementById("stage") as HTMLIFrameElement)
        .contentDocument!;
      const box = d.querySelector("[data-mirror-listbox]");
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const s = d.querySelector("select")!.getBoundingClientRect();
      return {
        options: [...box.querySelectorAll("[role=option]")].map((o) =>
          `${o.textContent}${
            o.getAttribute("aria-selected") === "true" ? "*" : ""
          }`
        ).join("|"),
        visible: r.width > 0 && r.height > 0 &&
          getComputedStyle(box).visibility !== "hidden",
        under: Math.abs(r.top - s.bottom) < 4 && Math.abs(r.left - s.left) < 4,
      };
    };
    const stageValue = () =>
      (document.getElementById("stage") as HTMLIFrameElement).contentDocument!
        .querySelector("select")?.value ?? null;

    expect.eq(
      await within(page, 1_000, stageValue),
      "net30",
      "the stage mirrors the closed select",
    );
    expect.eq(
      await page.evaluate(stageList),
      null,
      "closed: no list on the stage",
    );

    // 1. the customer clicks the select: its list opens (outside the DOM, on their screen)
    await page.locator("#terms").click();
    const open = await within(page, 1_000, stageList);
    await page.screenshot({ path: `${folder}/select-1-open.png` });
    expect.eq(
      JSON.stringify(open),
      JSON.stringify({
        options: "Due now|Net 30*|Net 60",
        visible: true,
        under: true,
      }),
      "REQ-638: the stage draws the open list under the select within 1 s",
    );

    // 2. a pick: the list closes, the value follows
    await page.locator("#terms").selectOption("net60");
    expect.eq(
      await within(page, 1_000, () => {
        const d = (document.getElementById("stage") as HTMLIFrameElement)
          .contentDocument!;
        return !d.querySelector("[data-mirror-listbox]") &&
          d.querySelector("select")?.value === "net60";
      }),
      true,
      "REQ-638: a pick closes the list on the stage, which shows Net 60",
    );

    // 3. opened again, then a click elsewhere closes it
    await page.locator("#terms").click();
    expect.eq(
      !!(await within(page, 1_000, stageList)),
      true,
      "open again",
    );
    await page.locator("#save").click();
    expect.eq(
      await within(
        page,
        1_000,
        () =>
          !(document.getElementById("stage") as HTMLIFrameElement)
            .contentDocument!.querySelector("[data-mirror-listbox]"),
      ),
      true,
      "REQ-638: a click elsewhere closes the list on the stage",
    );
  }));

// ---- 2. the app's ▾ send menu during a real demo ----

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
  body?: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** every wizard step answered in the browser until the quote review opens (as REQ-459's story) */
async function finishWizardToReview(page: Page) {
  const review = page.locator(".quote-review");
  const startQuestion = page.getByText(/when does the job start/i);
  await page.locator(".wiz__opts, .cust-create, .quote-review").first()
    .waitFor({ state: "visible", timeout: 20_000 });
  if (
    !(await review.first().isVisible().catch(() => false)) &&
    (await startQuestion.count()) === 0
  ) {
    if ((await page.locator(".cust-create").count()) === 0) {
      await page.locator(".wiz-opt--custom:visible").first().click();
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Menu Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550944");
    await page.locator(".cust-create__btn--primary").click();
  }
  const plain = page.locator(
    ".wiz__opts .wiz-opt:not(.wiz-opt--custom):visible",
  );
  for (let i = 0; i < 10; i++) {
    await page.locator(".quote-review, .wiz__opts .wiz-opt:visible").first()
      .waitFor({ state: "visible", timeout: 20_000 });
    if (await review.first().isVisible().catch(() => false)) return;
    const label = (await plain.first().innerText()).trim();
    await plain.first().click();
    await page.waitForFunction(
      (l) =>
        ![...document.querySelectorAll(".wiz__opts .wiz-opt")].some((e) =>
          (e as HTMLElement).offsetParent !== null &&
          (e as HTMLElement).innerText.trim() === l
        ),
      label,
      { timeout: 20_000 },
    ).catch(() => {});
  }
  await review.first().waitFor({ state: "visible", timeout: 20_000 });
}

const FRAME = "[data-cy='demo-frame']";

Deno.test("REQ-638 (cycle 5, M11): the customer opens the ▾ send menu during a demo — the stage shows .quote-review__send-menu within 1 s", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Jorge Ramirez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Jorge Ramirez",
      businessName: "Ramirez Landscaping",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      summary: "Lawn service",
      jobName: "Lawn service",
      lineItems: [{
        description: "Lawn service",
        quantity: 1,
        unit: "ea",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "draft",
    });
    const conv = await post(http, user.auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(
      http,
      user.auth,
      `/api/agents/conversations/${conv.id}/lock-quote`,
      { quoteId: quote.id },
    );
    await post(
      http,
      user.auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );

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
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();

      // the presenter opens the demo on Jorge's account
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

      // Jorge reaches his quote's review
      await userPage.goto(`${baseUrl}/assistant/${conv.id}`);
      await finishWizardToReview(userPage);
      const caret = userPage.locator(".quote-review__send-caret").first();
      await caret.waitFor({ state: "visible", timeout: 20_000 });
      const inFrame = (sel: string) =>
        page.evaluate(([f, s]) => {
          const d = (document.querySelector(f) as HTMLIFrameElement | null)
            ?.contentDocument;
          return !!d?.querySelector(s);
        }, [FRAME, sel] as const);
      // the stage mirrors the review before anything is opened
      const t0 = Date.now();
      while (!(await inFrame(".quote-review__send-caret"))) {
        if (Date.now() - t0 > 30_000) {
          throw new Error("timed out: the stage mirrors the quote review");
        }
        await page.waitForTimeout(150);
      }
      expect.eq(
        await inFrame(".quote-review__send-menu"),
        false,
        "closed: no send menu on the stage",
      );

      // he opens the ▾ send menu: the stage shows it within 1 s
      await caret.click();
      await userPage.locator(".quote-review__send-menu").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      const opened = Date.now();
      let seen = false;
      while (!seen && Date.now() - opened < 1_000) {
        seen = await inFrame(".quote-review__send-menu");
        if (!seen) await page.waitForTimeout(50);
      }
      // evidence only: a screenshot a loaded host cannot take never fails the check
      await page.screenshot({ path: `${folder}/send-menu-stage.png` }).catch(
        () => {},
      );
      await userPage.screenshot({ path: `${folder}/send-menu-customer.png` })
        .catch(() => {});
      expect.eq(
        seen,
        true,
        "REQ-638: the stage's frame holds .quote-review__send-menu within 1 s of it opening",
      );
      expect.eq(
        await page.evaluate((f) => {
          const d = (document.querySelector(f) as HTMLIFrameElement)
            .contentDocument!;
          const m = d.querySelector(".quote-review__send-menu")!;
          const r = m.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }, FRAME),
        true,
        "and it has a box on the stage (it is drawn, not just present)",
      );
      // its 140 ms fade-in runs on the stage too: within 1 s it is fully shown, not a ghost
      let opacity = "";
      const shown = Date.now();
      while (opacity !== "1" && Date.now() - shown < 1_000) {
        opacity = await page.evaluate((f) => {
          const d = (document.querySelector(f) as HTMLIFrameElement)
            .contentDocument!;
          const m = d.querySelector(".quote-review__send-menu");
          return m ? d.defaultView!.getComputedStyle(m).opacity : "gone";
        }, FRAME);
        if (opacity !== "1") await page.waitForTimeout(50);
      }
      expect.eq(opacity, "1", "the stage's menu is fully opaque within 1 s");
    } finally {
      await userCtx.close();
    }
  }));
