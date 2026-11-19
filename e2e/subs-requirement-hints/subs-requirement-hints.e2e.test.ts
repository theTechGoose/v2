/**
 * REQ-1067 — LOOP-007 cycle 2, q2-55: on /field/subscriptions → New, the
 * form kept saying "Pick at least one day." with Thursday ticked and "Add at
 * least one task type with a price." with "Pool cleaning $85" listed — the
 * form saved fine, the hints lied. A requirement hint shows only while its
 * requirement is unmet, in New and in Edit.
 */
import { story, type StoryTools } from "#shots";
import { addVisitService, ensureService } from "../_shared/service-lines.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

const DAYS_HINT = "Pick at least one day.";
const ITEMS_HINT = "Add at least one task type with a price.";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Field Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

/** what the form shows right now, read in one evaluate (no straddled render) */
async function hintState(page: StoryTools["page"]) {
  return await page.evaluate(([daysHint, itemsHint]) => {
    const form = document.querySelector("[data-cy='subs-form']");
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" &&
        cs.display !== "none";
    };
    const hints = form
      ? [...form.querySelectorAll(".hint")].filter(shown).map((e) =>
        (e.textContent ?? "").trim()
      )
      : [];
    return {
      ticked: form ? form.querySelectorAll("[data-cy='subs-day'].on").length : -1,
      items: form ? form.querySelectorAll("[data-cy='subs-item']").length : -1,
      daysHint: hints.some((h) => h.includes(daysHint)),
      itemsHint: hints.some((h) => h.includes(itemsHint)),
    };
  }, [DAYS_HINT, ITEMS_HINT]);
}

Deno.test("REQ-1067 (LOOP-007 q2-55): New / Edit repeat visit — 'Pick at least one day' and 'Add at least one task type' show only while unmet", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const c = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Rosa Pool",
        email: "rosa.pool@blackhole.postmarkapp.com",
      }),
    });
    await c.body?.cancel();
    const pool = await ensureService(http, auth, "Pool cleaning");

    await page.goto("/field/subscriptions");
    const open = page.locator("[data-cy='subs-new']").first();
    await open.waitFor({ timeout: 15_000 });
    await open.click();
    await page.locator("[data-cy='subs-form']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='subs-days']").waitFor({ timeout: 15_000 });

    // 1. as opened: today's weekday comes ticked, nothing listed yet
    const opened = await hintState(page);
    expect.eq(
      opened.daysHint,
      opened.ticked === 0,
      `New, as opened: the day hint shows only when no day is ticked — ${
        JSON.stringify(opened)
      }`,
    );
    expect.eq(
      opened.itemsHint,
      true,
      `New, as opened: no task listed, so the task hint shows — ${
        JSON.stringify(opened)
      }`,
    );

    // 2. untick every day → the requirement is unmet → the day hint shows
    for (let i = 0; i < 7; i++) {
      const on = page.locator("[data-cy='subs-day'].on").first();
      if (!(await on.count())) break;
      await on.click();
    }
    const none = await hintState(page);
    expect.eq(none.ticked, 0, "every day unticked");
    expect.eq(
      none.daysHint,
      true,
      `no day ticked: "${DAYS_HINT}" shows — ${JSON.stringify(none)}`,
    );

    // 3. tick Thursday, add "Pool cleaning $85" → both requirements met → both hints gone
    await page.locator("[data-cy='subs-day'][data-day='4']").click();
    await addVisitService(page, pool, "85");
    await page.locator("[data-cy='subs-item']").first().waitFor({
      timeout: 10_000,
    });
    const met = await hintState(page);
    expect.eq(met.ticked, 1, "Thursday is ticked");
    expect.eq(met.items, 1, "Pool cleaning is listed");
    expect.eq(
      met.daysHint,
      false,
      `Thursday ticked: "${DAYS_HINT}" is gone — ${JSON.stringify(met)}`,
    );
    expect.eq(
      met.itemsHint,
      false,
      `a task listed: "${ITEMS_HINT}" is gone — ${JSON.stringify(met)}`,
    );

    // 4. the form saves and the visit appears
    const box = page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-input']",
    );
    await box.fill("Rosa Pool");
    await page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Rosa Pool" }).first().click();
    await page.locator("[data-cy='subs-address']").fill(
      "4601 Dick Pond Rd, Myrtle Beach, SC",
    );
    await page.locator("[data-cy='subs-submit']").click();
    const card = page.locator("[data-cy='subs-card']").first();
    await card.waitFor({ timeout: 20_000 });
    await expect.see("Rosa Pool");

    // 5. Edit the saved visit: a day and a task already there → no requirement hint at all
    await card.locator("[data-cy='subs-edit']").click();
    await page.locator("[data-cy='subs-form']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='subs-item']").first().waitFor({
      timeout: 10_000,
    });
    const edit = await hintState(page);
    expect.eq(
      edit.daysHint || edit.itemsHint,
      false,
      `Edit: neither "${DAYS_HINT}" nor "${ITEMS_HINT}" shows on a saved visit — ${
        JSON.stringify(edit)
      }`,
    );
  }));
