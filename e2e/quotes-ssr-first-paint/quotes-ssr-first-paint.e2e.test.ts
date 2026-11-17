/**
 * REQ-471 (demo-loop cycle 3, issue p8-pair2-d) — "/quotes blank for 1–2 s
 * on load". The route server-rendered <QuotesPage /> with no data, so the
 * first HTML held only a shimmer skeleton until the island hydrated and
 * fetched GET /quotes. The route now loads the list server-side: the very
 * first HTML the server answers already carries the quote's card.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
    body: JSON.stringify({ language: "en", name: "First Paint Story" }),
  });
  await me.body?.cancel();
  return { auth, cookie };
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

Deno.test("REQ-471 (p8-pair2-d, cycle 3): the first HTML of /quotes already carries the quote's card — no blank skeleton until hydration", (t) =>
  story(t, async ({ expect, http }) => {
    const { auth, cookie } = await signIn(http);
    const customer = await post(http, auth, "/api/customers", {
      name: "Opal Paint",
      email: "opal@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Gate rebuild — Opal Paint",
      jobName: "Gate rebuild",
      description: "Rebuild the side gate.",
      lineItems: [{
        description: "Gate rebuild",
        quantity: 1,
        unit: "job",
        price: 64000,
      }],
      estimatedTotal: 64000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    // The server's own answer — no browser, no JS, no hydration.
    const res = await http("/quotes", {
      headers: { cookie: `${cookie}; pm_lang=en`, accept: "text/html" },
      redirect: "manual",
    });
    const html = await res.text();
    expect.eq(res.status, 200, "/quotes answers 200 for the signed-in owner");
    expect(
      html.includes('class="qcard'),
      "the first HTML carries a quote card (.qcard)",
    );
    expect(
      html.includes("Gate rebuild"),
      "the card names the quote's job (Gate rebuild)",
    );
  }));
