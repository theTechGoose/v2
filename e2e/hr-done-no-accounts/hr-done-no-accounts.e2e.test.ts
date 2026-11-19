/**
 * REQ-1156 (LOOP-007 q3-88) — a hire in a department with no systems is never promised accounts.
 * The hire signs a one-document packet for "Field crew" (no systems) in Spanish: the done screen
 * says nothing about accounts ("cuentas"). Back in the office the hire's Accounts panel says
 * "No systems for this department." and offers no "Create accounts" button (data-cy=hr-provision),
 * because an empty plan creates nothing (REQ-888(c): active at once).
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
    body: JSON.stringify({
      language: "en",
      name: "HR Story",
      email: "hr-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Monster Reservations Group" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth, phone, session: { name, value } };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`clickUntil: ${selector} never had its effect`);
}

/** a "Field crew" department with one acknowledgment document and no systems, and a hire in it */
async function noSystemsHire(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const doc = await (await http("/api/hr/documents", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Manual del empleado",
      kind: "ack",
      contentHtml: "<p>Sé amable.</p>",
    }),
  })).json();
  if (!doc.id) throw new Error(`no document: ${JSON.stringify(doc)}`);
  const dept = await (await http("/api/hr/departments", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Field crew", division: "outbound" }),
  })).json();
  if (!dept.id) throw new Error(`no department: ${JSON.stringify(dept)}`);
  await (await http(`/api/hr/departments/${dept.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ docIds: [doc.id], systemIds: [] }),
  })).body?.cancel();
  const hire = await (await http("/api/hr/hires", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      firstName: "Lucía",
      email: "lucia@example.com",
      departmentId: dept.id,
    }),
  })).json();
  if (!hire.token) throw new Error(`no hire: ${JSON.stringify(hire)}`);
  if (hire.systemIds?.length !== 0) {
    throw new Error(`the hire carries systems: ${JSON.stringify(hire)}`);
  }
  return { hire, doc };
}

Deno.test("REQ-1156 (LOOP-007 q3-88): signing a no-systems packet in Spanish — the done screen never promises accounts ('cuentas')", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const { hire } = await noSystemsHire(http, owner.auth);

    // the phone: no session, the token is the identity
    await page.context().clearCookies();
    await page.goto(`/sign/${hire.token}?lang=es`);
    await page.locator("[data-cy='hrs-start']").waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      "[data-cy='hrs-start']",
      async () => await page.locator("[data-cy='hrs-ack']").isVisible(),
    );
    await page.locator("[data-cy='hrs-ack']").check();
    await page.locator("[data-cy='hrs-next']").click();
    await page.locator("[data-cy='hrs-done']").waitFor({ timeout: 15_000 });
    const done = (await page.locator("[data-cy='hrs-done']").textContent()) ??
      "";
    expect.eq(
      /cuentas|accounts/i.test(done),
      false,
      `REQ-1156: the done screen promises no accounts for a no-systems department — got "${done.trim()}"`,
    );
  }));

Deno.test("REQ-1156 (LOOP-007 q3-88): a signed no-systems hire's Accounts panel says 'No systems for this department.' with no 'Create accounts' button", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const { hire, doc } = await noSystemsHire(http, owner.auth);
    const signed = await http(`/api/hr/sign/${hire.token}/docs/${doc.id}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ consent: true, printedName: "Lucía" }),
    });
    if (!signed.ok) {
      throw new Error(`sign failed ${signed.status}: ${await signed.text()}`);
    }
    await signed.body?.cancel();

    await page.goto(`/hr/hires/${hire.id}`);
    await page.locator("[data-cy='hr-detail-name']").waitFor({
      timeout: 15_000,
    });
    await expect.see("No systems for this department.");
    expect.eq(
      await page.locator("[data-cy='hr-provision']").count(),
      0,
      "REQ-1156: no 'Create accounts' button (data-cy=hr-provision) beside 'No systems for this department.'",
    );
  }));
