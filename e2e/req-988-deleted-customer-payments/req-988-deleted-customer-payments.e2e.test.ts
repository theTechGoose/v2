/**
 * REQ-988 (LOOP-007 q1, q1-71) — a deleted customer shows as "—" on
 * /payments, and its message link points to the deleted id.
 *
 * The delete prompt promises "Their quotes and invoices stay" and REQ-802
 * makes the delete a soft one; the invoice keeps a customerSnapshot of the
 * name. /payments read the payer only from the live customer list, so the
 * card said "— · INV-001", the top-payers row said "—", and the back's Text
 * client opened /clients?open=<the deleted id>.
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
    body: JSON.stringify({ language: "en", name: "Deleted Payer Story" }),
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

Deno.test("REQ-988 q1-71: after its customer is deleted, a /payments card still names the payer and its Text client link is not the deleted customer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const NAME = "Linda Pérez";
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: NAME, phoneNumber: "+15125550171" }),
    })).json() as { id: string };
    const today = new Date().toISOString().slice(0, 10);
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: "Roof patch",
        lineItems: [{
          description: "Roof patch",
          quantity: 1,
          unit: "job",
          price: 125000,
        }],
        amount: 125000,
        status: "sent",
        issuedDate: today,
        dueDate: today,
      }),
    })).json() as { id: string; customerSnapshot?: { name?: string } };
    expect.eq(inv.customerSnapshot?.name, NAME, "the invoice keeps a snapshot");
    const paid = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: 125000,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });
    expect(paid.ok, `the payment is recorded (${paid.status})`);
    await paid.body?.cancel();

    const del = await http(`/api/customers/${customer.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(del.ok, `the customer is deleted (${del.status})`);
    await del.body?.cancel();

    await page.goto("/payments");
    const card = page.locator("[data-cy='payment-card']").first();
    await card.waitFor({ timeout: 15_000 });
    // the card body renders after the island's load(): wait for the invoice ref
    await card.locator(".qcard__client-name").filter({ hasText: "INV-" })
      .waitFor({ timeout: 15_000 });

    const facts = await page.evaluate(() => {
      const c = document.querySelector("[data-cy='payment-card']")!;
      return {
        clientLine: c.querySelector(".qcard__client-name")?.textContent ?? "",
        story: c.querySelector(".qcard__story")?.textContent ?? "",
        textHref: c.querySelector("[data-cy='pay-card-text']")
          ?.getAttribute("href") ?? "",
        payors: [...document.querySelectorAll(".qside__row-name")].map((e) =>
          e.textContent ?? ""
        ),
      };
    });

    const wrong: string[] = [];
    if (!facts.clientLine.startsWith(NAME)) {
      wrong.push(
        `the card names the payer, not "—" (got "${facts.clientLine}")`,
      );
    }
    if (facts.story.includes("—")) {
      wrong.push(`the card's note names the payer (got "${facts.story}")`);
    }
    if (!facts.payors.includes(NAME) || facts.payors.includes("—")) {
      wrong.push(
        `top payers names the payer (got ${JSON.stringify(facts.payors)})`,
      );
    }
    if (facts.textHref.includes(`/clients?open=${customer.id}`)) {
      wrong.push(
        `Text client does not open the deleted customer (got "${facts.textHref}")`,
      );
    }
    expect(wrong.length === 0, `REQ-988: ${wrong.join(" | ")}`);
  }));
