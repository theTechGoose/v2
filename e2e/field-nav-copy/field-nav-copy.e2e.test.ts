/**
 * REQ-361 (demo cycle 1, issue M36) — on the real shell: the field pages sit in a root folder
 * called "Field" (not "Recurring"); /field/tasks on an empty day says how to add a one-off task;
 * and a worker with no zone on /field/workers carries a link that opens /field/assignments
 * (Assignments lives in the Field folder, Workers in Roles — REQ-178).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Hank Field" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return { auth };
}

Deno.test("REQ-361 (demo M36): the field pages sit in a 'Field' folder, Tasks says how to add a one-off, and a worker's 'No zone yet' opens Assignments", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Luis Herrera",
        phoneNumber: `843${digits()}`,
        pin: "1234",
      }),
    });
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();

    const nav = page.locator(".sb__nav");
    const labels = async () =>
      (await nav.locator(".nav-item__label").allInnerTexts()).map((s) =>
        s.trim()
      );
    // 1. the root names the folder "Field"
    await page.goto("/customers");
    await nav.locator("[data-cy='nav-folder-field']").waitFor({
      timeout: 20_000,
    });
    await nav.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      timeout: 20_000,
    });
    const root = await labels();
    expect(root.includes("Field"), `"Field" on the root (${root.join(", ")})`);
    expect(!root.includes("Recurring"), "no Recurring folder");
    await nav.locator("[data-cy='nav-folder-field']").click();
    await nav.locator("a[href='/field/assignments']").waitFor({
      timeout: 10_000,
    });

    // 2. an empty day on Tasks points at Add task, not at subscriptions alone
    await page.goto("/field/tasks");
    await expect.see("No tasks for this day — add one with Add task");

    // 3. the zone-less worker's hint is a link into Assignments
    await page.goto("/field/workers");
    const link = page.locator(
      "[data-cy='wk-row'] a[href='/field/assignments']",
    ).first();
    await link.waitFor({ timeout: 15_000 });
    expect.eq(
      (await link.innerText()).trim(),
      "No zone yet — assign one in Assignments.",
      "the hint is the link",
    );
    await link.click();
    await page.waitForURL(/\/field\/assignments/, { timeout: 20_000 });
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 20_000 });
    expect(
      await nav.locator("a[href='/field/assignments'].nav-item--active")
        .count() === 1,
      "Assignments opens inside the Field folder",
    );
  }));
