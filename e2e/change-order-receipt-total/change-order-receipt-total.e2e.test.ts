/**
 * REQ-1055 — LOOP-007 cycle 2, issue q2-39: after a change order is
 * approved, /co and the receipt email give two different "totals".
 *
 * QA's run: an $8,400 job, 30% deposit INV-001 $2,520, balance INV-002
 * $5,880, CO-001 +$2,800 on INV-002. After approving, /co read "tu total
 * ahora es $11,200.00" (the JOB total) while the receipt email read "Your
 * new invoice total: $8,680.00" (INV-002 only). Neither said which total.
 *
 * The story: the customer approves on /co → the /co intro names the job
 * total and its number equals the co-job-total figure; the receipt email in
 * the outbox shows that same job total, labeled, next to INV-002's total.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const plain = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

type Row = { id: string; kind: string; channel: string; to?: string };

async function seed(http: StoryTools["http"]) {
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload?: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", { name: "Hans Builder", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Cambio Builders",
    commsLanguage: "en",
  }, "PUT");
  const customerEmail = `maria${digits()}@blackhole.postmarkapp.com`;
  const customer = await call("/api/customers", {
    name: "María Nguyen",
    email: customerEmail,
  });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Bathroom remodel",
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 840_000,
    }],
    estimatedTotal: 840_000,
  });
  const line = (description: string, price: number) => [{
    description,
    quantity: 1,
    unit: "job",
    price,
  }];
  await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Bathroom remodel",
    lineItems: line("Deposit (30%)", 252_000),
    amount: 252_000,
    dueDate: "2026-12-30",
  });
  const balance = await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Bathroom remodel",
    status: "sent",
    lineItems: line("Balance", 588_000),
    amount: 588_000,
    dueDate: "2026-12-30",
  });
  const co = await call(`/api/invoices/${balance.id}/change-orders`, {
    description: "Add a second vanity",
    deltaAmountCents: 280_000,
  });
  return { call, coId: co.id as string, customerEmail };
}

Deno.test("REQ-1055 (LOOP-007 q2-39): after approving CO-001 on /co, the intro names the JOB total (= the co-job-total figure) and the receipt email shows that same job total, labeled, next to INV-002's", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await seed(http);
    const before = new Set(
      ((await s.call("/api/outbox", undefined, "GET")) as Row[]).map((r) =>
        r.id
      ),
    );

    // the customer: no session, opens the link and approves
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/co/${s.coId}?lang=en`);
    await page.getByRole("button", { name: "Approve this change" }).waitFor({
      timeout: 15_000,
    });
    const approved = page.locator("[data-cy=co-approved-by]");
    for (let i = 0; i < 10 && !(await approved.count()); i++) {
      try {
        await page.locator("[data-cy=co-name]").fill("María Nguyen", {
          timeout: 2_000,
        });
        await page.getByRole("button", { name: "Approve this change" })
          .click({ timeout: 2_000 });
        await approved.waitFor({ timeout: 2_000 });
      } catch { /* not hydrated yet, or the page is reloading */ }
    }
    await approved.waitFor({ timeout: 15_000 });

    // /co after approval: intro + job total, read together
    await page.goto(`${baseUrl}/co/${s.coId}?lang=en`);
    await page.locator("[data-cy=co-intro]").waitFor({ timeout: 15_000 });
    const co = await page.evaluate(() => ({
      intro: document.querySelector("[data-cy=co-intro]")?.textContent ?? "",
      job: document.querySelector("[data-cy=co-job-total]")?.textContent ??
        "",
    }));
    // "Job total $8,400.00 → $11,200.00" — the first arrow is the job line
    const jobNew = co.job.match(/→\s*(\$[\d,]+\.\d\d)/)?.[1] ?? "";
    expect.eq(jobNew, "$11,200.00", `the co-job-total figure (${co.job})`);
    const introNum = co.intro.match(/\$[\d,]+\.\d\d/)?.[0] ?? "";
    expect.eq(
      introNum,
      jobNew,
      `the intro's number is the job total (${co.intro})`,
    );
    // every wording problem is collected, so one run shows them all
    const problems: string[] = [];
    if (!/job total/i.test(co.intro)) {
      problems.push(
        `the /co intro says which total it is — the job total (got "${co.intro.trim()}")`,
      );
    }

    // the receipt email in the outbox
    let receipt: Row | undefined;
    for (let i = 0; i < 50 && !receipt; i++) {
      const rows = await s.call("/api/outbox", undefined, "GET") as Row[];
      receipt = rows.find((r) =>
        !before.has(r.id) && r.channel === "email" &&
        r.to === s.customerEmail
      );
      if (!receipt) await new Promise((res) => setTimeout(res, 200));
    }
    if (!receipt) throw new Error("no receipt email reached the outbox");
    const msg = await s.call(`/api/outbox/${receipt.id}`, undefined, "GET") as {
      body: string;
    };
    const mail = plain(msg.body);
    if (!mail.includes(jobNew)) {
      problems.push(
        `the receipt shows the job total /co shows (${jobNew}) (got: ${mail})`,
      );
    }
    if (!/job total[^$]*\$11,200\.00/i.test(mail)) {
      problems.push(`the receipt labels ${jobNew} as the job total`);
    }
    if (!mail.includes("$8,680.00")) {
      problems.push("the receipt shows INV-002's new total $8,680.00");
    }
    expect.eq(problems.join(" | "), "", "the two surfaces name their totals");
  }));
