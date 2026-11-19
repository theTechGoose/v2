/**
 * REQ-932 (LOOP-007 q1-18) — an empty packet is never sent, and a hire who somehow holds one is
 * never stranded. On /hr/hires/new, a department with no documents keeps "Create & send link"
 * disabled and the empty hint links the owner to where documents get added. On /sign/:token, a
 * legacy hire whose packet is empty sees an honest empty state — not the "about five minutes"
 * intro with a dead, disabled "Let's go".
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
  return { auth, phone };
}

Deno.test("REQ-932 (q1-18): a department with no documents keeps Create & send disabled, with a link to add documents", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const dept = await (await http("/api/hr/departments", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({ name: "Field crew", division: "outbound" }),
    })).json();
    if (!dept.id) throw new Error(`no department: ${JSON.stringify(dept)}`);

    await page.goto("/hr/hires/new");
    await page.locator("[data-cy='hr-dept'] option").nth(1).waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await page.locator("[data-cy='hr-first']").fill("Casey");
    await page.locator("[data-cy='hr-phone']").fill("7025551199");
    await page.locator("[data-cy='hr-email']").fill("casey@example.com");
    await page.locator("[data-cy='hr-dept']").selectOption({
      label: "Field crew",
    });
    await page.locator("[data-cy='hr-packet-empty']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='hr-create']").isDisabled(),
      true,
      "REQ-932: Create & send is disabled while the packet is empty",
    );
    const fix = page.locator(
      "[data-cy='hr-packet-empty'] a[href^='/hr/departments'], [data-cy='hr-packet-empty'] a[href^='/hr/documents']",
    );
    expect.eq(
      await fix.count() > 0,
      true,
      "REQ-932: the empty hint links to where documents get added",
    );
  }));

Deno.test("REQ-932 (q1-18): a legacy hire with an empty packet sees an honest empty state, not the five-minutes intro and a dead Let's go", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    // a real hire, so the token is real; the packet is then emptied on the wire, the shape a
    // hire created before the guard still has
    const doc = await (await http("/api/hr/documents", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({
        name: "Offer Letter",
        kind: "sign",
        contentHtml: "<p>Offer.</p>",
      }),
    })).json();
    const dept = await (await http("/api/hr/departments", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({ name: "Sales", division: "inbound" }),
    })).json();
    await (await http(`/api/hr/departments/${dept.id}`, {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ docIds: [doc.id] }),
    })).body?.cancel();
    const hire = await (await http("/api/hr/hires", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({
        firstName: "Marcus",
        email: "marcus@example.com",
        departmentId: dept.id,
      }),
    })).json();
    if (!hire.token) throw new Error(`no hire: ${JSON.stringify(hire)}`);

    await page.context().clearCookies();
    await page.route(`**/api/hr/sign/${hire.token}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const pk = await res.json();
      await route.fulfill({
        response: res,
        json: { ...pk, docs: [], progress: { done: 0, total: 0 } },
      });
    });
    await page.goto(`/sign/${hire.token}?lang=en`);
    await page.locator("[data-cy='hrs-empty'], [data-cy='hrs-hi']").first()
      .waitFor({ timeout: 15_000 });
    // let the island settle on whichever screen it picks
    await page.waitForTimeout(500);
    const body = (await page.locator("body").textContent()) ?? "";
    expect.eq(
      body.includes("five minutes"),
      false,
      "REQ-932: no 'about five minutes' promise for an empty packet",
    );
    const start = page.locator("[data-cy='hrs-start']");
    expect.eq(
      (await start.count()) > 0 && (await start.isDisabled()),
      false,
      "REQ-932: no disabled dead-end Let's go",
    );
    expect.eq(
      await page.locator("[data-cy='hrs-empty']").isVisible(),
      true,
      "REQ-932: an empty-state message (data-cy=hrs-empty) explains there is nothing to sign yet",
    );
  }));
