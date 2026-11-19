/**
 * REQ-939 (LOOP-007 cycle 1, q1-15) on the real app: in a new assistant chat
 * the owner types "Job done for Dana Whitfield: repaired her backyard gate
 * and replaced 2 posts, $850 total, plus a $200 deposit she already paid by
 * Zelle. Invoice her the balance, due in 7 days." Dana already has an older
 * invoice, INV-001 $2,489.75, paid by Zelle.
 *
 * QA got "INV-001 is already paid, so nothing new is recorded." and no
 * invoice. Expected: the invoice flow opens for Dana Whitfield at the $850
 * job with the $200 deposit credited — $650 due — and nothing is recorded.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the reply from
 * backend/src/agents/domain/coordinators/handle-chat-message).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SAID =
  "Job done for Dana Whitfield: repaired her backyard gate and replaced 2 posts, $850 total, plus a $200 deposit she already paid by Zelle. Invoice her the balance, due in 7 days.";

/** Signed in, past onboarding, in English. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  await answerQuestions(http, auth, {
    name: "Quinn Tester",
    businessName: "Tester Handyman",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** Dana Whitfield with an older invoice, $2,489.75, already paid by Zelle. */
async function danaPaidInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const dana = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Dana Whitfield",
      email: "dana.whitfield@blackhole.postmarkapp.com",
    }),
  })).json() as { id: string };
  const today = new Date().toISOString().slice(0, 10);
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: dana.id,
      jobName: "Fence staining",
      lineItems: [{
        description: "Fence staining",
        quantity: 1,
        unit: "job",
        price: 248_975,
      }],
      amount: 248_975,
      status: "sent",
      issuedDate: today,
      dueDate: today,
    }),
  })).json() as { id: string };
  const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ method: "zelle", reference: "ZL-88213" }),
  });
  if (claim.status !== 200) throw new Error(`claim: ${claim.status}`);
  await claim.body?.cancel();
  const confirm = await http(`/api/invoices/${inv.id}/confirm-payment`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  if (confirm.status !== 200) throw new Error(`confirm: ${confirm.status}`);
  await confirm.body?.cancel();
  const paid = await (await http(`/api/invoices/${inv.id}`, { headers: auth }))
    .json() as { status?: string };
  if (paid.status !== "paid") {
    throw new Error(`seed: INV-001 is ${paid.status}, not paid`);
  }
}

async function paymentCount(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<number> {
  const rows = await (await http("/api/payments", { headers: auth }))
    .json() as unknown[];
  return Array.isArray(rows) ? rows.length : -1;
}

/** Type the line and send it once the island is live; never twice. */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  const pad = page.locator(".chat__price-capture");
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0 || await pad.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0 || await pad.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

Deno.test("REQ-939 q1-15: in a new chat, 'Job done for Dana Whitfield … $850 total, plus a $200 deposit she already paid by Zelle. Invoice her the balance' opens the invoice flow ($650 due) — never 'INV-001 is already paid'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await danaPaidInvoice(http, auth);
    const paymentsBefore = await paymentCount(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, SAID);

    // wait for the assistant's answer: its bubble in the thread, or the
    // invoice flow it opened (the price pad covers the thread, so no bubble
    // is visible then)
    await page.locator(".msg:not(.msg--user), .chat__price-capture").last()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(
      () =>
        !!document.querySelector(".chat__price-capture") ||
        /already paid/i.test(document.body.innerText),
      undefined,
      { timeout: 30_000 },
    ).catch(() => undefined);

    const convoId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const detail = await (await http(`/api/agents/conversations/${convoId}`, {
      headers: auth,
    })).json() as {
      messages?: { role: string; content: string; payload?: unknown }[];
    };
    const said = (detail.messages ?? []).filter((m) => m.role === "assistant")
      .map((m) => m.content).join(" ");
    expect(
      !/is already paid/i.test(said),
      `no "INV-001 is already paid" dead end (got: ${said})`,
    );
    expect.eq(
      await paymentCount(http, auth),
      paymentsBefore,
      "no payment is recorded",
    );
    const offer = (detail.messages ?? []).map((m) =>
      (m.payload as
        | {
          invoiceFlow?: {
            customerName?: string;
            amountCents?: number;
            depositPaidCents?: number;
          };
        }
        | undefined)?.invoiceFlow
    ).find((o) => !!o);
    expect(!!offer, `the reply carries the invoice flow (got: ${said})`);
    expect.eq(offer?.customerName, "Dana Whitfield", "who to bill");
    expect.eq(offer?.amountCents, 85_000, "the job's $850 total");
    expect.eq(offer?.depositPaidCents, 20_000, "the $200 already paid");
    expect(said.includes("$650"), `the reply says $650 is due (got: ${said})`);
    const pad = page.locator(".chat__price-capture");
    expect.eq(await pad.count() > 0, true, "the invoice flow is on screen");
  }));
