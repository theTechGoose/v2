/**
 * REQ-550 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue B1: on /invoices → New
 * invoice, no client picked, no bill-to, $99,999,999 typed, "Issue invoice"
 * → the list showed the invoice as Sent, and the yellow missing-info box did
 * not stop it.
 *
 * Now: Issue with no client and no bill-to name is refused in the form
 * (nothing is created); with a bill-to name, an amount over $250,000 asks for
 * a second press; and with no email or phone to send it to, the invoice is
 * saved as a draft with a "not sent — share the link" notice, never Sent.
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal
 * → POST /api/invoices).
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
    body: JSON.stringify({ language: "en", name: "Issue Guard Story" }),
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

Deno.test("REQ-550 B1: Issue with no client and no bill-to is refused; $99,999,999 to a typed bill-to asks to confirm; with no contact it is a draft with a 'not sent — share the link' notice, never Sent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const list = async () =>
      await (await http("/api/invoices", { headers: auth })).json() as Array<
        {
          status?: string;
          sentAt?: string;
          amount?: number;
          billTo?: { name?: string };
        }
      >;

    await page.goto("/invoices?new=1");
    await page.locator("[data-cy='new-invoice-modal']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='new-invoice-amount']").fill("99999999");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ??
        "").includes("99,999,999")
    );

    // 1) no client, no bill-to → refused in the form, nothing created
    await page.locator("[data-cy='new-invoice-submit']").click();
    const alert = page.locator("[data-cy='new-invoice-modal'] [role=alert]");
    await alert.waitFor({ timeout: 10_000 });
    const why = await alert.innerText();
    expect(
      /client|billed to/i.test(why),
      `the form asks for a recipient (${why})`,
    );
    expect.eq((await list()).length, 0, "no invoice was created");

    // 2) a typed bill-to name → the huge amount asks for a second press
    await page.locator("[data-cy='new-invoice-bill-name']").fill("Walk-in");
    await page.locator("[data-cy='new-invoice-submit']").click();
    const confirm = page.locator("[data-cy='new-invoice-confirm-large']");
    await confirm.waitFor({ timeout: 10_000 });
    expect(
      (await confirm.innerText()).includes("$99,999,999"),
      "the confirm names the amount",
    );
    expect.eq((await list()).length, 0, "still nothing created");

    // 3) the second press issues it — with no contact, a draft, never Sent
    await page.locator("[data-cy='new-invoice-submit']").click();
    const notice = page.locator("[data-cy='invoice-not-sent']");
    await notice.waitFor({ timeout: 20_000 });
    const text = await notice.innerText();
    expect(/INV-\d+/.test(text) && /not sent/i.test(text), `notice: ${text}`);
    expect(/\/i\//.test(text), `the notice carries the share link (${text})`);

    const all = await list();
    expect.eq(all.length, 1, "one invoice was created");
    expect.eq(all[0].status, "draft", "nothing sent → not listed as sent");
    expect.eq(all[0].sentAt, undefined, "no sentAt");
    expect.eq(all[0].billTo?.name, "Walk-in", "billed to the typed name");
  }));
