/**
 * REQ-554 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issues M9, m23, m43, m52. RCA
 * CONFIRMED / UPHELD at ad104a19.
 *
 * In a browser, with a window marker that a page load would wipe:
 * (a) M9 + m52 — "Send now" on a scheduled invoice whose customer has an
 *     email and a fictional 555 phone (REQ-695): the card leaves Upcoming for Sent with no reload,
 *     its due date is today + its 30 days to pay (not the schedule's), and
 *     the half-delivered note shows what went in green, what failed in red.
 * (b) m43 + m23 — "Payment confirmed" on a claimed card: no reload, a
 *     "Payment confirmed" note, the card leaves Awaiting and the sidebar's
 *     Invoices badge drops by one.
 * (c) M9 (extends REQ-493) — the change order approved in person in another
 *     tab of the owner's browser: the open /invoices shows the new total
 *     within 4 s, before the topbar's 10 s notifications tick.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
    body: JSON.stringify({ language: "en", name: "Card Refresh Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** the card's own short date for yyyy-mm-dd (en, this year: "Dec 12") */
function cardDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const s = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear()
    ? s
    : `${s}, ${d.getFullYear()}`;
}

function invoice(customerId: string, jobName: string, extra: object) {
  return {
    customerId,
    jobName,
    lineItems: [{
      description: jobName,
      quantity: 1,
      unit: "job",
      price: 40000,
    }],
    amount: 40000,
    ...extra,
  };
}

function card(page: StoryTools["page"], jobName: string) {
  return page.locator("article.qcard", {
    has: page.locator("[data-cy='invoice-card-job']", { hasText: jobName }),
  }).first();
}

async function markPage(page: StoryTools["page"]) {
  // islands hydrated before the click (a pre-hydration click is a no-op)
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => {
    (globalThis as Record<string, unknown>).__req554 = "same page";
  });
}

async function samePage(page: StoryTools["page"]) {
  return await page.evaluate(() =>
    (globalThis as Record<string, unknown>).__req554 ?? null
  );
}

/** the sidebar's Invoices badge as a number (0 when it shows none) */
async function invoicesBadge(page: StoryTools["page"]) {
  const pill = page.locator("a.nav-item[href*='/invoices'] .nav-item__count");
  if (!(await pill.count())) return 0;
  return Number((await pill.first().innerText()).trim());
}

Deno.test("REQ-554 (demo M9 + m52, cycle 4): 'Send now' with the text failing re-reads in place — the card moves to Sent, due today + 30, the note green for what went", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Marisol Ortega",
      email: "mo@blackhole.postmarkapp.com",
      // REQ-695 (cycle 5, M23): a client with NO phone is just "sent by
      // email" now; the half-delivered note needs a text that really fails —
      // a fictional 555 number never reaches Twilio.
      phoneNumber: "+15125550142",
    });
    const job = `Porch rails ${digits()}`;
    await post(
      http,
      auth,
      "/api/invoices",
      invoice(customer.id, job, {
        status: "scheduled",
        scheduledFor: inDays(7),
        dueDate: inDays(37),
        netDays: 30,
      }),
    );

    await page.goto("/invoices");
    const c = card(page, job);
    const cta = c.locator("[data-cy='invoice-cta-scheduled']");
    await cta.waitFor({ timeout: 15_000 });
    await markPage(page);
    await cta.click();
    // REQ-727 (cycle 5, c4-M16): "Send now" opens the send sheet — nothing
    // goes until its Send. Text + Email, so the 555 text really fails.
    await page.locator("[data-cy='send-dialog']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='send-option-both']").click();
    await page.locator("[data-cy='send-keep']").click();

    const moved = await card(page, job).locator("[data-cy='invoice-cta-out']")
      .waitFor({ timeout: 15_000 }).then(() => true, () => false);
    expect(moved, "the sent invoice leaves Upcoming for Sent without a reload");
    expect.eq(await samePage(page), "same page", "no page load");
    expect.eq(
      await page.locator(
        "[data-cy='upcoming-track'] [data-cy='invoice-card-job']",
        {
          hasText: job,
        },
      ).count(),
      0,
      "nothing left in Upcoming",
    );
    const due = await card(page, job).locator(".qcard__val-num").innerText();
    expect.eq(
      due.trim(),
      cardDate(inDays(30)),
      "due today + 30, not the schedule's",
    );

    const went = page.locator("[data-cy='send-partial-went']");
    await went.waitFor({ timeout: 5_000 });
    const color = (sel: string) =>
      page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    expect.eq(
      await color("[data-cy='send-partial-went']"),
      "rgb(81, 152, 67)",
      `what went reads green ("${await went.innerText()}")`,
    );
    expect.eq(
      await color("[data-cy='send-partial-failed']"),
      "rgb(168, 59, 59)",
      "only what failed reads red",
    );
  }));

Deno.test("REQ-554 (demo m43 + m23, cycle 4): 'Payment confirmed' on a claimed card re-reads in place, says so, and the sidebar badge drops", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Dewey Harlan",
      email: "dh@blackhole.postmarkapp.com",
    });
    const job = `Gutter guards ${digits()}`;
    const sent = { status: "sent", issuedDate: inDays(0), dueDate: inDays(14) };
    const inv = await post(
      http,
      auth,
      "/api/invoices",
      invoice(customer.id, job, sent),
    );
    await post(
      http,
      auth,
      "/api/invoices",
      invoice(customer.id, `Other ${job}`, sent),
    );
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", reference: "ZL-554" }),
    });
    expect.eq(claim.status, 200, "the client's claim is accepted");
    await claim.body?.cancel();

    await page.goto("/invoices");
    const cta = card(page, job).locator("[data-cy='invoice-cta-claimed']");
    await cta.waitFor({ timeout: 15_000 });
    await markPage(page);
    const before = await invoicesBadge(page);
    expect(before > 0, `the sidebar counts the open invoices (${before})`);
    await cta.click();

    // the paid track (06) is collapsed by default: the card leaves 02
    const awaiting = page.locator(
      "[data-cy='awaiting-confirmation-track'] [data-cy='invoice-card-job']",
      { hasText: job },
    );
    const left = await awaiting.first().waitFor({
      state: "detached",
      timeout: 15_000,
    }).then(() => true, () => false);
    expect(left, "the confirmed invoice leaves Awaiting confirmation in place");
    expect.eq(await samePage(page), "same page", "no page load");
    await page.locator("[data-cy='payment-confirmed']").waitFor({
      timeout: 5_000,
    });
    const deadline = Date.now() + 5_000;
    let after = await invoicesBadge(page);
    while (after >= before && Date.now() < deadline) {
      await page.waitForTimeout(200);
      after = await invoicesBadge(page);
    }
    expect.eq(after, before - 1, "the sidebar's Invoices badge drops by one");
  }));

Deno.test("REQ-554 (demo M9, cycle 4; extends REQ-493): a change order approved in another tab reaches the open /invoices within 4 s", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Inez Varga",
      email: "iv@blackhole.postmarkapp.com",
    });
    const job = `Fence stain ${digits()}`;
    const inv = await post(
      http,
      auth,
      "/api/invoices",
      invoice(customer.id, job, {
        status: "sent",
        issuedDate: inDays(0),
        dueDate: inDays(14),
      }),
    );
    const co = await post(http, auth, `/api/invoices/${inv.id}/change-orders`, {
      description: "Second coat",
      deltaAmountCents: 8_500,
    });

    await page.goto("/invoices");
    const title = card(page, job).locator(".qcard__title");
    await title.waitFor({ timeout: 15_000 });
    expect.eq((await title.innerText()).trim(), "$400", "before");
    await markPage(page);

    // the customer, handed the owner's device: "Approve in person"
    const tab = await page.context().newPage();
    await tab.goto(`${baseUrl}/co/${co.id}?as=customer&confirm=1`);
    const approved = tab.locator("[data-cy=co-approved-by]");
    await tab.locator("[data-cy=co-name]").waitFor({ timeout: 15_000 });
    await tab.waitForLoadState("networkidle").catch(() => {});
    for (let i = 0; i < 10 && !(await approved.count()); i++) {
      try {
        await tab.locator("[data-cy=co-name]").fill("Inez Varga", {
          timeout: 2_000,
        });
        await tab.getByRole("button", { name: "Approve this change" })
          .click({ timeout: 2_000 });
        await approved.waitFor({ timeout: 2_000 });
      } catch { /* not hydrated yet, or the page is reloading */ }
    }
    await approved.waitFor({ timeout: 15_000 });
    const decidedAt = Date.now();

    const followed = await page.waitForFunction(
      (j) =>
        [...document.querySelectorAll("article.qcard")].some((el) =>
          el.textContent?.includes(j) &&
          el.querySelector(".qcard__title")?.textContent?.trim() === "$485"
        ),
      job,
      { timeout: 4_000 },
    ).then(() => true, () => false);
    expect(
      followed,
      `the open /invoices shows $485 within 4 s (${
        Date.now() - decidedAt
      } ms after the approval; card reads ${await title.innerText()})`,
    );
    expect.eq(await samePage(page), "same page", "no page load");
    await tab.close();
  }));
