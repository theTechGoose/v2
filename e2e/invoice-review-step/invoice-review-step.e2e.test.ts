/**
 * REQ-627 — "they cannot delay the invoice": the assistant's invoice flow
 * ends at a review step. Picking an accepted job → the review → the ready
 * card, where the invoice is still a DRAFT (nothing sent) and the card offers
 * Send now / Save as draft / Schedule. Schedule writes status "scheduled" +
 * the day; Send now issues it ("sent").
 *
 * Page: front-end/islands/AsstChat.tsx (the "Job done, need to invoice." chip
 * → accepted-job chip → invoiceReview → invoiceResult card).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Alexander Jerez",
    businessName: "A2Z Landscape LLC",
  });
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function seedAcceptedJob(
  http: StoryTools["http"],
  auth: Record<string, string>,
  jobName: string,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: `rb-${Date.now()}@blackhole.postmarkapp.com`,
    }),
  })).json();
  const quote = await (await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      jobName,
      summary: jobName,
      lineItems: [{
        description: jobName,
        quantity: 1,
        unit: "ea",
        price: 65000,
      }],
      estimatedTotal: 65000,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    }),
  })).json();
  if (!quote?.id) throw new Error(`seed quote: ${JSON.stringify(quote)}`);
  return quote.id as string;
}

type Inv = { id: string; quoteId?: string; status?: string; scheduledFor?: string };
async function invoiceFor(
  http: StoryTools["http"],
  auth: Record<string, string>,
  quoteId: string,
): Promise<Inv | undefined> {
  const rows = await (await http("/api/invoices", { headers: auth })).json() as Inv[];
  return rows.find((i) => i.quoteId === quoteId);
}

/** chip → accepted job → review → Continue → the ready card */
async function driveToReadyCard(page: StoryTools["page"], jobName: string) {
  await page.goto("/assistant");
  const chip = page.locator("button.chat__empty-prompt", {
    hasText: "Job done, need to invoice.",
  });
  await chip.waitFor({ timeout: 20_000 });
  // a click before hydration is lost — click until the chip's flow opens
  for (let i = 0; i < 40 && (await chip.count()); i++) {
    await chip.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const job = page.locator("button.chat__accepted-job", { hasText: jobName });
  await job.first().waitFor({ timeout: 20_000 });
  await job.first().click();
  const save = page.locator("[data-cy='invoice-flow-save']");
  await save.waitFor({ timeout: 20_000 });
  await save.click();
  await page.locator("[data-cy='invoice-ready-send']").waitFor({
    timeout: 20_000,
  });
}

Deno.test("REQ-627: the assistant's invoice flow stops at a review step — a draft until Send now; Schedule picks the day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);

    // 1. Schedule: the ready card holds a DRAFT; Schedule → status scheduled + the day
    const q1 = await seedAcceptedJob(http, auth, "Spring cleanup");
    await driveToReadyCard(page, "Spring cleanup");
    await expect.see("nothing has gone to your customer yet");
    await expect.see("Save as draft");
    await expect.see("Schedule");
    const draft = await invoiceFor(http, auth, q1);
    expect.eq(draft?.status, "draft", "the review saves a draft, never 'sent'");
    await page.locator("[data-cy='invoice-ready-schedule']").click();
    const when = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await page.locator("[data-cy='invoice-schedule-date']").fill(when);
    await page.locator("[data-cy='invoice-schedule-confirm']").click();
    await page.locator("[data-cy='invoice-ready-scheduled']").waitFor({
      timeout: 20_000,
    });
    await expect.see(`Scheduled for ${when}`);
    const scheduled = await invoiceFor(http, auth, q1);
    expect.eq(scheduled?.status, "scheduled", "Schedule → scheduled");
    expect.eq(scheduled?.scheduledFor, when, "on the picked day");

    // 2. Send now: one tap issues it
    const q2 = await seedAcceptedJob(http, auth, "Mulch install");
    await driveToReadyCard(page, "Mulch install");
    expect.eq((await invoiceFor(http, auth, q2))?.status, "draft", "a draft until Send now");
    await page.locator("[data-cy='invoice-ready-send']").click();
    await page.waitForURL(/\/invoices/, { timeout: 20_000 });
    expect.eq((await invoiceFor(http, auth, q2))?.status, "sent", "Send now → sent");
  }));
