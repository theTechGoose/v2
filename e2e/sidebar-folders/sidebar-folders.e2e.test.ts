/**
 * REQ-156 — sidebar folders on the real shell: /dashboard shows the Field folder (REQ-361, was Recurring) and none of
 * the five field entries; opening it shows Back and only the five; Tasks opens /field/tasks with
 * the sidebar already inside the folder; Back shows the root again.
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
  return { cookie, auth: { ...JSON_HEADERS, cookie } };
}

Deno.test("REQ-156: the root shows Field (REQ-361, was Recurring) and none of the five; opening it shows Back and only the five; Tasks opens /field/tasks inside the folder; Back shows the root again", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const user = await verify(http, `+1512${digits()}`);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Ana Torres" }),
    })).body?.cancel();
    const [name, value] = user.cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));

    const nav = page.locator(".sb__nav");
    const labels = async () =>
      (await nav.locator(".nav-item__label").allInnerTexts()).map((s) =>
        s.trim()
      );

    // 1. the root: Field (REQ-361) is a row, the five are not (/customers: a new account's /dashboard lands on the /welcome wizard, which has no sidebar — REQ-091)
    await page.goto("/customers");
    await nav.locator("[data-cy='nav-folder-field']").waitFor({
      timeout: 20_000,
    });
    // the rail hydrates in Spanish for a beat, then the profile's English lands — wait for it
    await nav.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      timeout: 20_000,
    });
    let seen = await labels();
    expect(
      seen.includes("Field"),
      `Field (REQ-361, was Recurring) on the root (${seen.join(", ")})`,
    );
    expect(seen.includes("Customers"), "Customers on the root");
    for (
      const l of ["Subscriptions", "Assignments", "Tasks", "Batches"]
    ) expect(!seen.includes(l), `${l} is inside the folder, not on the root`);
    expect(
      await nav.locator("[data-cy='nav-back']").count() === 0,
      "no Back on the root",
    );
    // 2. open the folder: Back and only the five
    await nav.locator("[data-cy='nav-folder-field']").click();
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 10_000 });
    seen = await labels();
    for (
      const l of ["Subscriptions", "Assignments", "Tasks", "Batches"]
    ) expect(seen.includes(l), `${l} inside the folder (${seen.join(", ")})`);
    // REQ-604 (demo m18): Workers is listed in Field too (it stays in Roles, REQ-178)
    expect(
      seen.includes("Workers"),
      `Workers inside Field (${seen.join(", ")})`,
    );
    expect(!seen.includes("Customers"), "the root's entries are gone");
    expect(
      !seen.includes("Field"),
      "the folder row itself is gone (its name is the header)",
    );

    // 3. Tasks opens its page with the sidebar already inside the folder
    await nav.locator("a[href='/field/tasks']").click();
    await page.waitForURL(/\/field\/tasks/, { timeout: 20_000 });
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 20_000 });
    seen = await labels();
    expect(
      seen.includes("Batches") && !seen.includes("Customers"),
      `inside the folder on load (${seen.join(", ")})`,
    );
    expect(
      await nav.locator("a[href='/field/tasks'].nav-item--active").count() ===
        1,
      "Tasks is the active entry",
    );

    // 4. Back: the root again
    await nav.locator("[data-cy='nav-back']").click();
    await nav.locator("[data-cy='nav-folder-field']").waitFor({
      timeout: 10_000,
    });
    seen = await labels();
    expect(
      seen.includes("Customers") && !seen.includes("Tasks"),
      `the root after Back (${seen.join(", ")})`,
    );
  }));
