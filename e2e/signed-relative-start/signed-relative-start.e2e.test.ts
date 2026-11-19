/**
 * REQ-1104 — LOOP-007 cycle 3, issue q3-27 [major/BUG_HARM]: "Signed
 * agreement freezes the relative start date 'Next week'". The demo's owner
 * picked "Next week" in the terms wizard, sent the quote and the customer
 * signed; afterwards /q (Terms → "Start date: Next week" / "FECHA DE INICIO
 * La próxima semana") and the deposit invoice /i INV-001 named no week at
 * all — read a week later the clause points at a different week.
 *
 * The owner walks the real wizard (start_date → next_week), sends, the
 * customer signs, and the Start date row on /q and on the deposit /i must
 * carry the concrete day the app anchors it to (sent + 7, the day the
 * invoice schedule uses) — in English and in Spanish.
 */
import { story, type StoryTools } from "#shots";
import { formatTermDate } from "../../shared/quote-flow/format-helpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const TOTAL = 240_000;

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
    body: JSON.stringify({ language: "en", name: "Tom Baker" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({ name, value, domain, path: "/" })),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** A 50/50 quote whose start the owner picked as "Next week" in the wizard,
 *  sent, then signed by the customer on /q's endpoint. */
async function signedNextWeekQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Linda Ortiz",
    email: `linda.ortiz.${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Fence repair",
    jobName: "Fence repair",
    lineItems: [{
      description: "Fence repair",
      quantity: 1,
      unit: "job",
      price: TOTAL,
    }],
    estimatedTotal: TOTAL,
    status: "draft",
  });
  const conv = await post(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
    customerId: customer.id,
  });
  const convId = (conv.id ?? conv.conversation?.id) as string;
  await post(http, auth, `/api/agents/conversations/${convId}/lock-quote`, {
    quoteId: quote.id,
  });
  await post(
    http,
    auth,
    `/api/agents/conversations/${convId}/transition-to-terms`,
    {},
  );
  const answer = (stepId: string, optionId: string) =>
    post(http, auth, "/api/agents/wizard/answer", {
      conversationId: convId,
      stepId,
      optionId,
    });
  await answer("customer", "use_active");
  await answer("start_date", "next_week");
  await answer("wraps", "2_3_days");
  await answer("payment_terms", "50_50");
  await answer("warranty", "12_months");
  await post(http, auth, `/api/agents/conversations/${convId}/send-quote`, {
    quoteId: quote.id,
    channel: "email",
    language: "en",
  });
  const r = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Linda Ortiz", signature: "Linda Ortiz" }),
  });
  const signed = await r.json();
  if (r.status !== 200) {
    throw new Error(`accept → ${r.status} ${JSON.stringify(signed)}`);
  }
  const saved = await (await http(`/api/quotes/${quote.id}`, {
    headers: auth,
  })).json() as {
    sentAt?: string;
    createdAt: string;
    terms?: { stepId: string; value: string }[];
  };
  const invoices = (await (await http("/api/invoices", { headers: auth }))
    .json() as { id: string; quoteId?: string; createdAt: string }[])
    .filter((i) => i.quoteId === quote.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (invoices.length === 0) throw new Error("signing billed no deposit");
  return { quote, saved, depositId: invoices[0].id };
}

/** The Start date row of the Terms grid — label and value as rendered. */
async function startRow(page: StoryTools["page"]): Promise<string> {
  await page.locator(".ctr__terms-grid").first().waitFor({ timeout: 20_000 });
  return await page.evaluate(() => {
    const grid = document.querySelector(".ctr__terms-grid");
    for (const cell of Array.from(grid?.children ?? [])) {
      const [k, v] = Array.from(cell.children).map((c) =>
        (c.textContent ?? "").trim()
      );
      if (/^(start date|fecha de inicio)$/i.test(k ?? "")) return v ?? "";
    }
    return "(no start row)";
  });
}

/** sent + 7 days, as an ISO day — UTC, and the US business day before it
 *  when the send landed after midnight UTC (either is the anchored day). */
function anchoredDays(sentAt: string): string[] {
  const sent = new Date(sentAt);
  const plus7 = (d: Date) =>
    new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  return [
    ...new Set([plus7(sent), plus7(new Date(sent.getTime() - 10 * 3_600_000))]),
  ];
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1104 (LOOP-007 q3, q3-27) ${lang}: after the customer signs a 'Next week' start, /q and the deposit /i Terms name the concrete start day`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl);
      const { quote, saved, depositId } = await signedNextWeekQuote(http, auth);
      expect.eq(
        saved.terms?.find((x) => x.stepId === "start_date")?.value,
        "Next week",
        "the wizard stored the 'Next week' preset (the repro precondition)",
      );
      const days = anchoredDays(saved.sentAt ?? saved.createdAt)
        .map((iso) => formatTermDate(iso, lang));
      const bare = lang === "es" ? "La próxima semana" : "Next week";

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/q/${quote.id}?lang=${lang}`);
      await page.locator("[data-cy='quote-signed-banner']").waitFor({
        timeout: 20_000,
      });
      const q = await startRow(page);

      await page.goto(`/i/${depositId}?lang=${lang}`);
      const i = await startRow(page);
      // Both surfaces are read before failing, so a red names each one.
      const wrong = [["/q", q], ["/i deposit", i]]
        .filter(([, v]) => !days.some((d) => v.includes(d)))
        .map(([where, v]) => `${where} Start date reads "${v}"`);
      expect(
        wrong.length === 0,
        `the Start date names the day (${
          days.join(" or ")
        }), not a bare "${bare}" — ${wrong.join("; ")}`,
      );
    }));
}
