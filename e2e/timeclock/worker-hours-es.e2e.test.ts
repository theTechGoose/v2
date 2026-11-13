/**
 * REQ-786 (demo dv1, "Workers can clock in and out, and the owner sees their hours") — the demo
 * check, in Spanish: the owner adds a worker; the worker signs in on /worker, clocks in, waits,
 * clocks out; the owner opens THAT worker's hours from their row on /field/workers and sees the
 * one shift on a timesheet narrowed to them, with "Todos los trabajadores" back to everyone.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Reloj Historia" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { session: { name, value } };
}

const waitState = (page: StoryTools["page"], state: "in" | "out") =>
  page.waitForFunction(
    (s: string) =>
      document.querySelector("[data-cy='clock-button']")?.getAttribute(
        "data-state",
      ) === s,
    state,
    { timeout: 15_000 },
  );

Deno.test("REQ-786: in Spanish, a worker clocks in and out on /worker and the owner opens that worker's hours from their row", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const cell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;

    // two workers, so "that worker's hours" has to narrow
    await page.goto("/field/workers");
    for (
      const [name, phone] of [["Marta Otra", `843556${cell.slice(-4)}`], [
        "Luis Reloj",
        cell,
      ]]
    ) {
      await page.locator("[data-cy='wk-name']").fill(name);
      await page.locator("[data-cy='wk-phone']").fill(phone);
      await page.locator("[data-cy='wk-pin']").fill("1234");
      await page.locator("[data-cy='wk-add']").click();
      await page.locator("[data-cy='wk-row']", { hasText: name }).waitFor({
        timeout: 15_000,
      });
    }

    // the worker, on /worker, in Spanish: Marcar entrada → wait → Marcar salida
    await page.context().clearCookies();
    await page.goto("/worker?lang=es");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-tab-clock']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='w-tab-clock']").click();
    const button = page.locator("[data-cy='clock-button']");
    await waitState(page, "out");
    expect.eq(
      (await button.textContent())?.trim(),
      "Marcar entrada",
      "es: clock in",
    );
    await button.click();
    await waitState(page, "in");
    expect.eq(
      (await button.textContent())?.trim(),
      "Marcar salida",
      "es: clock out",
    );
    await expect.see("Trabajando");
    await page.waitForTimeout(1_500);
    await button.click();
    await waitState(page, "out");

    // the owner: Workers → Luis Reloj's "Horas" → the timesheet narrowed to Luis
    await page.context().clearCookies();
    await page.context().addCookies([{ ...owner.session, url: baseUrl }]);
    await page.goto("/field/workers");
    const row = page.locator("[data-cy='wk-row']", { hasText: "Luis Reloj" });
    await row.waitFor({ timeout: 15_000 });
    const hours = row.locator("[data-cy='wk-hours']");
    expect.eq(
      (await hours.textContent())?.trim(),
      "Horas",
      "es: the Hours link",
    );
    await hours.click();
    await page.waitForURL(/\/field\/timesheet\?worker=/, { timeout: 15_000 });
    await page.locator("[data-cy='ts-shift']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='ts-worker']").count(),
      1,
      "only that worker",
    );
    expect.eq(
      (await page.locator("[data-cy='ts-worker-name']").textContent())?.trim(),
      "Luis Reloj",
      "it is Luis",
    );
    expect.eq(
      await page.locator("[data-cy='ts-shift'][data-open='0']").count(),
      1,
      "the closed shift",
    );
    expect.eq(
      await page.locator("[data-cy='ts-punch']").count(),
      2,
      "Luis's two punches",
    );
    await expect.see("Entrada");
    await expect.see("Salida");

    // back to everyone
    await page.locator("[data-cy='ts-all-workers']").click();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-cy='ts-worker']").length === 2,
      undefined,
      { timeout: 15_000 },
    );
    await expect.see("Marta Otra");
  }));
