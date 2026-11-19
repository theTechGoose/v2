/**
 * REQ-1145 — AMENDMENT of REQ-1004 (LOOP-007 cycle 3, q3-76): on /field/subscriptions the
 * New repeat visit form's "Ends on" accepted a date before First visit with no inline
 * error; the only message was the shared bottom alert after Save, and only once the
 * customer / address / services / days checks had passed — so a form with no service row
 * showed the service error and never the end-date one.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  // the dev backend can still be booting when Vite answers: retry while it is unreachable
  let r: Response;
  let body: Record<string, unknown>;
  for (let i = 0;; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || i >= 90) break;
    await new Promise((ok) => setTimeout(ok, 2_000));
  }
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

const MSG = "Ends on can't be before the first visit";

Deno.test("REQ-1145 (LOOP-007 q3, q3-76): Ends on before First visit shows an inline error before Save, clears when First visit moves, and Save shows it rather than the service error", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ending Ed",
        address: "4601 Dick Pond Rd, Myrtle Beach, SC",
        email: "ending.ed@blackhole.postmarkapp.com",
      }),
    });
    await r.body?.cancel();
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    const box = page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-input']",
    );
    await box.waitFor({ timeout: 15_000 });
    await box.fill("Ending Ed");
    await page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ending Ed" }).first().click();
    const address = page.locator("[data-cy='subs-address']");
    if (!(await address.inputValue()).trim()) {
      await address.fill("4601 Dick Pond Rd, Myrtle Beach, SC");
    }

    const start = page.locator("[data-cy='subs-start']");
    const end = page.locator("[data-cy='subs-end']");
    await start.waitFor({ timeout: 15_000 });
    await start.fill("2026-11-19");
    await end.fill("2026-11-01");

    const inline = page.locator("[data-cy='subs-end-error']");
    // 1 — before Save: the field itself says what is wrong
    let shown = false;
    try {
      await inline.waitFor({ state: "visible", timeout: 5_000 });
      shown = true;
    } catch { /* stays false */ }
    expect.eq(
      shown,
      true,
      "an inline [data-cy=subs-end-error] shows under Ends on before Save (Ends on Nov 1, First visit Nov 19)",
    );
    expect.eq(
      ((await inline.textContent()) ?? "").trim(),
      MSG,
      "the inline error reads the end-before-start message",
    );
    expect.eq(
      await end.getAttribute("aria-invalid"),
      "true",
      "the Ends on input is marked aria-invalid",
    );

    // 2 — moving First visit before the end clears it
    await start.fill("2026-10-25");
    await inline.waitFor({ state: "detached", timeout: 5_000 });

    // 3 — back to a bad pair, no service row: Save names the end date, not the service gap
    await start.fill("2026-11-19");
    await page.locator("[data-cy='subs-submit']").click();
    await page.waitForFunction(
      () =>
        !!document.querySelector("[data-cy='subs-error']") ||
        !!document.querySelector("[data-cy='subs-end-error']"),
      undefined,
      { timeout: 10_000 },
    );
    const msgs = await page.evaluate(() => ({
      bottom: document.querySelector("[data-cy='subs-error']")?.textContent
        ?.trim() ?? null,
      inline: document.querySelector("[data-cy='subs-end-error']")
        ?.textContent?.trim() ?? null,
    }));
    expect.eq(
      msgs.inline === MSG && (msgs.bottom === null || msgs.bottom === MSG),
      true,
      `Save shows the end-date message, not the service error — ${
        JSON.stringify(msgs)
      }`,
    );
  }));
