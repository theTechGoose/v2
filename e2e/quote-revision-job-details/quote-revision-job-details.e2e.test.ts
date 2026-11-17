/**
 * REQ-561 (demo-loop cycle 4, M28) — the revision editor edits the job
 * details the customer reads.
 *
 * Demo report M28: in "Edit → Version 2" on a sent quote, "my 3 bullet lines
 * … are not here" — the editor had line items only, while the agreement's
 * job-detail bullets are quote.description. The editor now has a "Job
 * details" textarea prefilled with those bullets; saving files the new text
 * in the pending revision (the customer keeps Version 1), the publish
 * preview says "Job details changed", and publishing puts the new bullet on
 * the customer's page.
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Revise Story" }),
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

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "ea",
  price,
});

const V1 = "Remove old shingles\nInstall underlayment\nHaul debris";

Deno.test("REQ-561 (M28): 'Edit → Version 2' shows the job-detail bullets; a new bullet is saved as the unpublished revision, the preview says 'Job details changed', and publishing puts it on the customer's page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
      address: "18 Rosewood Ln, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Roof repair — Dana Whitfield",
      jobName: "Roof Repair Dana",
      lang: "en",
      description: V1,
      lineItems: [line("Shingles and labor", 450000)],
      estimatedTotal: 450000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });

    await page.goto(`/quotes?open=${quote.id}`);
    const editBtn = page.locator("[data-cy='quote-edit']");
    await editBtn.waitFor({ timeout: 15_000 });
    await editBtn.click();
    const details = page.locator("[data-cy='quote-edit-job-details']");
    await details.waitFor({ timeout: 10_000 });
    expect.eq(
      await details.inputValue(),
      V1,
      "the editor shows the three bullets the customer reads",
    );
    await details.fill(
      "Remove old shingles\nInstall underlayment\nReplace two rotted rafters\nHaul debris",
    );
    await page.locator("[data-cy='quote-edit-save']").click();
    await page.locator("[data-cy='quote-pending-badge']").waitFor({
      timeout: 15_000,
    });

    const stored = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(stored.description, V1, "the customer still reads Version 1");
    expect(
      (stored.pendingRevision?.description ?? "").includes(
        "Replace two rotted rafters",
      ),
      "the new bullet waits in the pending revision",
    );

    await page.locator("[data-cy='quote-publish']").click();
    const changes = page.locator("[data-cy='quote-publish-changes']");
    await changes.waitFor({ timeout: 10_000 });
    expect(
      (await changes.innerText()).includes("Job details changed"),
      "the publish preview says the job details changed",
    );
    await page.locator("[data-cy='quote-publish-confirm']").click();
    await page.locator("[data-cy='quote-published-note']").waitFor({
      timeout: 15_000,
    });
    const published = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(published.version, 2, "publishing makes Version 2");

    await page.goto(`/q/${quote.id}`);
    await expect.see("Replace two rotted rafters");
  }));
