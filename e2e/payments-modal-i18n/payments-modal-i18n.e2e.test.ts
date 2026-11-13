/**
 * REQ-587 — demo-loop cycle 4, issue M27: the Spanish "Registrar un pago"
 * modal on /payments listed "Invoice · María González · $450" and the
 * "Recibido el" picker showed 11/12/2026 (the browser's en-US locale).
 *
 *   In Spanish, the "¿Qué factura?" option never says "Invoice", and the
 *   picked day is spelled out in Spanish next to the native date input.
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
    body: JSON.stringify({ language: "es", name: "Payment Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "es",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

Deno.test("REQ-587 M27: the Spanish record-payment modal says 'Factura' (not 'Invoice') and spells the date in Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "María González",
        email: "mg@blackhole.postmarkapp.com",
      }),
    })).json();
    // No jobName: the old label fell back to the English word "Invoice".
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        dueDate: inDays(5),
        lineItems: [{
          description: "Pintura",
          quantity: 1,
          unit: "job",
          price: 45000,
        }],
        amount: 45000,
      }),
    })).json();

    await page.goto("/payments");
    await page.locator("[data-cy='payments-record']").first().click();
    const select = page.locator("[data-cy='payments-record-invoice']");
    await select.waitFor({ timeout: 15_000 });
    const option = select.locator(`option[value='${inv.id}']`);
    const label = (await option.textContent())?.trim() ?? "";
    expect(!/Invoice/.test(label), `the option is Spanish (${label})`);
    expect(label.includes("María González"), `names the customer (${label})`);
    expect(label.includes("$450"), `shows the amount (${label})`);
    if (!inv.number) {
      expect(label.startsWith("Factura"), `the localized word (${label})`);
    } else {
      expect(label.startsWith(inv.number), `the invoice number (${label})`);
    }

    await select.selectOption(inv.id);
    const dateText = page.locator("[data-cy='pay-received-date-text']");
    await dateText.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='pay-received-date']").fill("2026-11-12");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='pay-received-date-text']")
          ?.textContent?.includes("12 de noviembre de 2026"),
      undefined,
      { timeout: 15_000 },
    );
    const text = (await dateText.innerText()).trim();
    expect.eq(text, "12 de noviembre de 2026", `the date in Spanish (${text})`);
  }));
