/**
 * REQ-1056 (LOOP-007 cycle 2, q2-41) — English UI (/login?lang=en), the owner
 * types Spanish in the assistant. The reply comes back in Spanish (REQ-438)
 * and tells them to tap "Publicar revisión", but the pill under it reads
 * "Open Q-00N → Publish revision" and the /quotes button reads "Publish
 * revision and notify customer". The label the reply quotes must be one the
 * owner can see: the pill's, or the button's on the quote it opens.
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
    body: JSON.stringify({ language: "en", name: "Label Story" }),
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

Deno.test("REQ-1056 q2-41: English UI, a Spanish change order on a sent quote — the button label the Spanish reply quotes is on the owner's screen (the pill or the /quotes button), never 'Publicar revisión'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Label Story",
      businessName: "Label Story LLC",
    });
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Dana Whitfield",
      jobName: "Bathroom Remodel Dana",
      lineItems: [
        line("Plumbing fixtures", 115000),
        line("Tile floor and walls", 480000),
      ],
      estimatedTotal: 595000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    // Typed in Spanish, the app in English.
    await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Orden de cambio para Dana Whitfield en ${number}: agregar un piso radiante $1,200`,
    }).then(async (chat) => {
      await page.goto(`/assistant/${chat.conversation.id}?lang=en`);
    });
    const link = page.locator("[data-cy='msg-quote-link']");
    await link.waitFor({ timeout: 20_000 });
    // One read: the bubble and the pill under it.
    const seen = await link.evaluate((a) => ({
      bubble:
        (a.parentElement?.querySelector(".msg__bubble") as HTMLElement | null)
          ?.innerText ?? "",
      pill: (a as HTMLElement).innerText.trim(),
    }));
    const quoted = /["“]([^"”]+)["”]/.exec(seen.bubble)?.[1];
    expect(!!quoted, `the reply names a button to tap (${seen.bubble})`);
    expect(
      !seen.bubble.includes("Publicar revisión"),
      `the Spanish reply quotes "Publicar revisión" under the English pill "${seen.pill}": ${seen.bubble}`,
    );

    await link.click();
    await page.waitForURL(`**/quotes?open=${quote.id}`, { timeout: 15_000 });
    const button = page.locator("[data-cy='quote-publish']");
    await button.waitFor({ timeout: 15_000 });
    const buttonText = (await button.innerText()).trim();
    expect(
      seen.pill.includes(quoted ?? "\u0000") ||
        buttonText.includes(quoted ?? "\u0000"),
      `the quoted label "${quoted}" is on screen — pill "${seen.pill}", /quotes button "${buttonText}"`,
    );
  }));
