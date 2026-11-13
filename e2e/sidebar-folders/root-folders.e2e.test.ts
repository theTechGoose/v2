/**
 * REQ-176 — the sidebar's root on the real shell: Dashboard, Customers, Billing, Admin and nothing
 * else; Billing opens to Quotes, Invoices, Payments; Admin to Workers and Admins, Field to the four; Back climbs one
 * level at a time; a page inside a nested folder loads inside it.
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

Deno.test("REQ-176: the root is Dashboard, Customers, Billing, Field (REQ-361, was Recurring), Admin; Billing opens to Quotes, Invoices, Payments, Work orders and Invoices loads inside it; Admin opens to Workers and Admins; Field to the four; Back returns to the root; /field/tasks loads inside Field", (t) =>
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
    // 1. the root: four rows, nothing else
    await page.goto("/customers");
    await nav.locator("[data-cy='nav-folder-billing']").waitFor({
      timeout: 20_000,
    });
    // the rail hydrates in Spanish for a beat, then the profile's English lands — wait for it
    await nav.locator(".nav-item__label", { hasText: "Customers" }).waitFor({
      timeout: 20_000,
    });
    let seen = await labels();
    expect.eq(
      seen.join(" | "),
      "Dashboard | Customers | Outbox | Billing | Field | Roles",
      "the root is the six rows (REQ-784 added Outbox)",
    );
    // 2. Billing: Back, Quotes, Invoices, Payments, Work orders; Invoices loads inside it
    await nav.locator("[data-cy='nav-folder-billing']").click();
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 10_000 });
    seen = await labels();
    expect.eq(
      seen.join(" | "),
      "Back | Quotes | Invoices | Payments | Work orders",
      "inside Billing (REQ-210 added Work orders)",
    );
    await nav.locator("a[href='/invoices']").click();
    await page.waitForURL(/\/invoices/, { timeout: 20_000 });
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 20_000 });
    expect(
      await nav.locator("a[href='/invoices'].nav-item--active").count() === 1,
      "Invoices is the active entry, inside Billing on load",
    );
    expect(
      (await labels()).includes("Payments"),
      "the sidebar opened inside Billing",
    );
    // 3. Back to the root, then Admin: Admins alone (Field is on the root — the amendment)
    await nav.locator("[data-cy='nav-back']").click();
    await nav.locator("[data-cy='nav-folder-manage']").waitFor({
      timeout: 10_000,
    });
    await nav.locator("[data-cy='nav-folder-manage']").click();
    await nav.locator("a[href='/admins']").waitFor({ timeout: 10_000 });
    seen = await labels();
    expect.eq(
      seen.join(" | "),
      "Back | Workers | Timesheet | Editors",
      "inside Admin (Workers moved here — REQ-178; Timesheet beside it — REQ-192)",
    );
    await nav.locator("[data-cy='nav-back']").click();
    // 4. Field (REQ-361, was Recurring), on the root: the five; Back lands on the root
    await nav.locator("[data-cy='nav-folder-field']").waitFor({
      timeout: 10_000,
    });
    await nav.locator("[data-cy='nav-folder-field']").click();
    await nav.locator("a[href='/field/batches']").waitFor({ timeout: 10_000 });
    seen = await labels();
    expect.eq(
      seen.join(" | "),
      "Back | Repeat visits | Assignments | Tasks | Batches | Workers", // REQ-743: was Subscriptions
      "inside Field (REQ-361, was Recurring; REQ-604: Workers listed here too)",
    );
    await nav.locator("[data-cy='nav-back']").click();
    await nav.locator("[data-cy='nav-folder-billing']").waitFor({
      timeout: 10_000,
    });
    expect((await labels()).includes("Customers"), "Back landed on the root");
    // 5. a page inside a folder opens inside it
    await page.goto("/field/tasks");
    await nav.locator("[data-cy='nav-back']").waitFor({ timeout: 20_000 });
    seen = await labels();
    expect(
      seen.includes("Batches") && !seen.includes("Editors"),
      `inside Field on load (${seen.join(", ")})`,
    );
  }));
