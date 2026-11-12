/**
 * REQ-608 — demo-loop cycle 4, demo issue m47: "Worker note saves with no 'Saved'; batch unticked
 * after reload". (a) /field/batches after F5 shows the pulled drafts ticked and "Send selected"
 * enabled, as right after the pull. (b) On /worker, "Note saved" is still on screen 2.5 s after
 * Save (it used to vanish after 1.5 s, timed from before the reload), and typing clears it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** an owner with one worker and one staffed subscription due today */
async function officeDay(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await http(path, {
      method,
      headers: auth,
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  await call("PUT", "/api/me", { language: "en", name: "Field Story" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  const today = todayIso();
  const customer = await call("POST", "/api/customers", {
    name: "Ana Torres",
    email: "ana.torres@blackhole.postmarkapp.com",
  });
  const cell = `843${digits()}`;
  const worker = await call("POST", "/api/field/workers", {
    name: "Luis Herrera",
    phoneNumber: cell,
    pin: "1234",
  });
  const sub = await call("POST", "/api/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: today,
    items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
  });
  await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
    workerId: worker.id,
  });
  const tasks = await call("GET", `/api/field/tasks?date=${today}`);
  return { call, today, cell, tasks };
}

Deno.test("REQ-608 (demo m47, cycle 4): a pulled batch's drafts are still ticked after a reload, and Send selected is enabled", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { call, today, tasks } = await officeDay(http, page, baseUrl);
    expect.eq(tasks.length, 1, "one task today");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, {
      status: "complete",
    });

    await page.goto("/field/batches");
    await page.locator("[data-cy='lt-from']").fill(today);
    await page.locator("[data-cy='lt-to']").fill(today);
    await page.locator("[data-cy='lt-pull']").click();
    const box = page.locator("[data-cy='lt-check']")
      .first();
    await box.waitFor({ timeout: 20_000 });
    expect(await box.isChecked(), "the draft is ticked right after the pull");

    await page.reload();
    await box.waitFor({ timeout: 20_000 });
    // the island hydrates after the SSR shell; give its load() a moment
    await page.waitForFunction(
      () => {
        const b = document.querySelector<HTMLInputElement>(
          "[data-cy='lt-check']",
        );
        return !!b && b.checked;
      },
      undefined,
      { timeout: 15_000 },
    ).catch(() => {});
    expect(await box.isChecked(), "the draft is still ticked after F5");
    expect(
      await page.locator("[data-cy='lt-send']").isEnabled(),
      "Send selected is enabled after F5",
    );
  }));

Deno.test("REQ-608 (demo m47, cycle 4): the worker's 'Note saved' is still there 2.5 s after Save, and typing clears it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cell } = await officeDay(http, page, baseUrl);
    await page.context().clearCookies();
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-visit']").first().waitFor({
      timeout: 20_000,
    });
    await page.locator("[data-cy='w-note-btn']").first().click();
    const note = page.locator("[data-cy='w-note']").first();
    await note.waitFor({ timeout: 10_000 });
    await note.fill("Gate code 4411");
    await page.locator("[data-cy='w-note-save']").first().click();
    await page.locator("[data-cy='w-note-dot']").first().waitFor({
      timeout: 15_000,
    });
    await page.waitForTimeout(2500);
    expect.eq(
      await page.locator(".saved", { hasText: "Note saved" }).count(),
      1,
      "'Note saved' is still on screen 2.5 s after Save",
    );
    await expect.see("Note saved");
    await note.fill("Gate code 4412");
    expect.eq(
      await page.locator(".saved", { hasText: "Note saved" }).count(),
      0,
      "editing the note again clears 'Note saved'",
    );
  }));
