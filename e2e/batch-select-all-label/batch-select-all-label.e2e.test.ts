/**
 * REQ-996 — LOOP-007 cycle 1, QA issue q1-81: "Batch 'Select all' label doesn't select anything".
 * After a pull every draft is ticked (REQ-608), yet the header read "Select all"; clicking it
 * unticked everything and disabled Send. The header must say what a click does: "Clear all"
 * while every draft is ticked, then "Select all" once they are cleared, and back.
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

Deno.test("REQ-996 (LOOP-007 q1-81): the batch header reads 'Clear all' when every draft is ticked, and flips to 'Select all' after clearing", (t) =>
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
    const box = page.locator("[data-cy='lt-check']").first();
    const send = page.locator("[data-cy='lt-send']");
    await box.waitFor({ timeout: 20_000 });
    expect(
      await box.isChecked(),
      "REQ-608: the draft is ticked after the pull",
    );
    expect(await send.isEnabled(), "Send selected is enabled after the pull");

    // the current batch's header: the one holding Send selected (the past-batches panel has its own)
    const header = page.locator("h3.panel__title", { has: send });
    const headerText = async () =>
      (await header.innerText()).replace(/\s+/g, " ");
    const before = await headerText();
    expect(
      before.includes("Clear all"),
      `everything ticked → the header offers "Clear all" (header: ${
        JSON.stringify(before)
      })`,
    );
    expect(
      !before.includes("Select all"),
      `everything ticked → the header does not promise "Select all" (header: ${
        JSON.stringify(before)
      })`,
    );

    // click the control's TEXT, as the tester did
    await header.getByText("Clear all", { exact: true }).click({
      timeout: 5_000,
    });
    await page.waitForFunction(
      () => {
        const b = document.querySelector<HTMLInputElement>(
          "[data-cy='lt-check']",
        );
        return !!b && !b.checked;
      },
      undefined,
      { timeout: 10_000 },
    );
    const cleared = await headerText();
    expect(
      cleared.includes("Select all") && !cleared.includes("Clear all"),
      `after Clear all → the header offers "Select all" (header: ${
        JSON.stringify(cleared)
      })`,
    );
    expect(!(await box.isChecked()), "after Clear all the draft is unticked");
    expect(
      await send.isDisabled(),
      "after Clear all Send selected is disabled",
    );

    await header.getByText("Select all", { exact: true }).click({
      timeout: 5_000,
    });
    await page.waitForFunction(
      () => {
        const b = document.querySelector<HTMLInputElement>(
          "[data-cy='lt-check']",
        );
        return !!b && b.checked;
      },
      undefined,
      { timeout: 10_000 },
    );
    expect(await box.isChecked(), "after Select all the draft is ticked");
    expect(await send.isEnabled(), "after Select all Send selected is enabled");
    const after = await headerText();
    expect(
      after.includes("Clear all"),
      `everything ticked again → the header offers "Clear all" (header: ${
        JSON.stringify(after)
      })`,
    );
  }));
