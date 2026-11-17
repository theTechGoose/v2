/**
 * REQ-664 (demo-loop cycle 5, m43, run r37f88707) on the real app — pair 5
 * asked the assistant to make the SIGNED Q-001's cabinets cheaper and got
 * "Q-001 Kitchen Remodel is signed, so its lines can't change. Add or credit
 * the difference with a change order instead." with only "Open Q-001"; she
 * had to re-type the request as a change order.
 *
 * Now the reply offers the difference: a one-tap "Make change order
 * −$1,000 for Cabinets" button; tapping it makes that change order on the
 * job's open invoice and the reply names it (Open CO-00N as customer).
 *
 * Page: /assistant/:id (front-end/islands/AsstChat.tsx, [data-cy=msg-co-offer]);
 * server: revise-quote (the offer) + handle-chat-message (the yes).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
    body: JSON.stringify({ language: "en", name: "Locked Offer Story" }),
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
  unit: "job",
  price,
});

Deno.test("REQ-664 m43: a price edit on a signed quote offers 'Make change order −$1,000 for Cabinets'; one tap makes that change order on the open invoice and Q-001's lines stay", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Locked Offer Story",
      businessName: "Locked Offer Story LLC",
    });
    const dana = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: dana.id,
      summary: "Kitchen Remodel — Dana Whitfield",
      jobName: "Kitchen Remodel",
      lineItems: [
        line("Demo and haul-away", 180000),
        line("Cabinets", 350000),
        line("Countertops", 1100000),
      ],
      estimatedTotal: 1630000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Dana Whitfield",
      version: 1,
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    // the demo's ask, on the signed quote (read in code — no model needed)
    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Change order for Dana Whitfield on ${number}: change cabinets to $2,500`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    expect.eq(reply.payload?.quoteRevision?.kind, "locked", reply.content);
    expect.eq(
      reply.payload?.quoteRevision?.changeOrderOffer?.deltaCents,
      -100000,
      "the difference is offered",
    );

    await page.goto(`/assistant/${chat.conversation.id}`);
    const offer = page.locator("[data-cy='msg-co-offer']");
    await offer.waitFor({ timeout: 20_000 });
    expect.eq(
      (await offer.innerText()).trim(),
      "Make change order −$1,000 for Cabinets",
      "the one-tap offer names the difference and the line",
    );
    const open = page.locator("[data-cy='msg-co-open']");
    for (let i = 0; i < 20 && await open.count() === 0; i++) {
      if (await offer.count() > 0) {
        await offer.click({ timeout: 2_000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    await open.waitFor({ timeout: 20_000 });
    expect(
      /^View CO-\d+ as customer$/.test((await open.innerText()).trim()),
      "the reply names the new change order",
    );
    const ledger = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    const cos = (ledger.changeOrders ?? []) as { deltaAmountCents: number }[];
    expect.eq(
      JSON.stringify(cos.map((c) => c.deltaAmountCents)),
      JSON.stringify([-100000]),
      "exactly one change order, −$1,000",
    );
    const after = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(after.lineItems[1].price, 350000, "Q-001's lines stay");
  }));
