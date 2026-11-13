/**
 * REQ-424 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 2,
 * issue p2 ("Heavy polling"): an idle /admin re-read `GET /api/admin/users` every 2–5 s, and one
 * "Save name" sent `PUT /api/me` twice.
 *
 * In a browser, as a super admin still on the seeded placeholder name:
 *  - /admin left alone for 30 s re-reads its users at most 3 times (it backs off while idle;
 *    the old fixed 5 s refresh made it 6);
 *  - the staff name form submitted twice in one task (a fast Enter + click) sends ONE PUT /api/me.
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped DENO_DEPLOY=true).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** how long /admin is left alone */
const IDLE_MS = 30_000;

/** a super admin still on the placeholder name, signed in on `page` */
async function placeholderSuperAdmin(
  { page, expect, http, baseUrl }: StoryTools,
): Promise<Record<string, string>> {
  const phone = `+1512${digits()}`;
  let r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    r = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await r.json();
    cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      phoneNumber: phone,
      token: Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "",
    }),
  });
  expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
  const [name, value] = cookie.split("=");
  const hosts = new Set([
    new URL(baseUrl).hostname,
    "localhost",
    "127.0.0.1",
  ]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));

  return auth;
}

/** counts the users-list reads and PUT /api/me from `page` */
function watch(page: StoryTools["page"]) {
  const n = { usersReads: 0, mePuts: 0 };
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/api/admin/users") n.usersReads++;
    if (u.pathname === "/api/me" && req.method() === "PUT") n.mePuts++;
  });
  return n;
}

async function openAdmin(page: StoryTools["page"]) {
  await page.goto("/admin");
  await page.locator("[data-cy='staff-name-input'][data-ready]").waitFor({
    timeout: 15_000,
  });
  await page.locator("[data-cy='adm-name']").first().waitFor({
    timeout: 15_000,
  });
}

Deno.test("REQ-424 p2: an idle /admin backs off its users refresh — at most 3 re-reads in 30 s, not 6", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await placeholderSuperAdmin(tools);
    const n = watch(page);
    await openAdmin(page);
    // the first load is not a refresh
    n.usersReads = 0;
    await page.waitForTimeout(IDLE_MS);
    expect(
      n.usersReads <= 3,
      `an idle /admin re-read its users ${n.usersReads} times in ${IDLE_MS} ms (≤ 3; a fixed 5 s refresh is 6)`,
    );
    expect(
      n.usersReads >= 1,
      `it still refreshes while idle (${n.usersReads})`,
    );
  }));

Deno.test("REQ-424 p2: the staff name form submitted twice in one task (a fast Enter + click) sends ONE PUT /api/me", (t) =>
  story(t, async (tools) => {
    const { page, expect, http } = tools;
    const auth = await placeholderSuperAdmin(tools);
    const n = watch(page);
    await openAdmin(page);
    // one save, submitted twice before the island re-renders (a fast Enter + click)
    await page.locator("[data-cy='staff-name-input'][data-ready]").fill(
      "Polly Staff",
    );
    await page.evaluate(() => {
      const form = document.querySelector(
        "[data-cy='staff-name-prompt'] form",
      ) as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.locator("[data-cy='staff-name-prompt']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    await page.waitForTimeout(1_000);
    expect.eq(n.mePuts, 1, "one save sent one PUT /api/me");
    const saved = await (await http("/api/me", { headers: auth })).json();
    expect.eq(saved.name, "Polly Staff", "the name is on record");
  }));
