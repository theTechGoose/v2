/**
 * REQ-1032 (LOOP-007 q2, q2-15) — one Zelle phone, one display on the customer's invoice page.
 * The business typed its Zelle handle as 5125550700. On /i/:id?lang=es the "Pay online" Zelle row
 * read "Envía a 5125550700" while the payment instructions on the same invoice read
 * "Zelle: (512) 555-0700". The row must read "Envía a (512) 555-0700"; its Copy button still puts
 * the digits the customer pastes into their bank app, "5125550700", on the clipboard.
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
  return { ...JSON_HEADERS, cookie };
}

Deno.test("REQ-1032 (q2-15): a Zelle handle typed as 5125550700 — /i/:id?lang=es reads 'Envía a (512) 555-0700', and Copy still copies the digits", (t) =>
  story(t, async ({ page, expect, http }) => {
    const auth = await signIn(http);
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es", name: "Alexander Jerez" }),
    })).body?.cancel();
    const put = await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        businessName: "A2Z Landscape",
        acceptedPaymentMethods: {
          zelle: { enabled: true, handle: "5125550700" },
        },
      }),
    });
    expect.eq(put.status, 200, "Zelle handle saved as typed");
    await put.body?.cancel();

    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        email: "ana@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Lawn care",
        amount: 6500,
        issuedDate: "2026-11-01",
        dueDate: "2026-11-30",
        paymentInstructions: "Zelle: (512) 555-0700",
      }),
    })).json();

    // capture what the Copy button writes
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (s: string) => {
            w.__copied.push(s);
            return Promise.resolve();
          },
        },
      });
    });

    // the customer's page, in Spanish
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}?lang=es`);
    const row = page.locator("[data-cy='pay-zelle-value']");
    await row.waitFor({ timeout: 15_000 });
    expect.eq(
      (await row.innerText()).trim(),
      "Envía a (512) 555-0700",
      "the Pay-online Zelle row reads the phone like the payment instructions do",
    );

    // Copy still copies the raw digits — click until the island has hydrated
    for (let i = 0; i < 20; i++) {
      await page.locator("[data-cy='pay-zelle-copy']").click();
      const n = await page.evaluate(() =>
        (window as unknown as { __copied: string[] }).__copied.length
      );
      if (n > 0) break;
      await page.waitForTimeout(500);
    }
    const copied = await page.evaluate(() =>
      (window as unknown as { __copied: string[] }).__copied
    );
    expect.eq(copied[0], "5125550700", "Copy puts the digits on the clipboard");
  }));
