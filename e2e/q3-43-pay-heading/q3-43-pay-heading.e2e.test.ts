/**
 * REQ-1118 (LOOP-007 q3, q3-43) — /i calls a Zelle send-to card "Pay online".
 * A business that takes only Zelle: /i/:id showed the heading "Pay online"
 * ("Paga en línea") above a card that reads "Zelle / Send to {handle} / Copy".
 * Nothing on it is paid online. The heading over a block of copy rows only must
 * be a neutral one; "Pay online" heads link buttons only.
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

Deno.test("REQ-1118 (LOOP-007 q3-43): a Zelle-only business — /i/:id (en and es) does not head the Zelle card 'Pay online'", (t) =>
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

    for (
      const [lang, banned] of [["en", /pay online/i], [
        "es",
        /paga en l[ií]nea/i,
      ]] as const
    ) {
      await page.context().clearCookies();
      await page.goto(`/i/${inv.id}?lang=${lang}`);
      const block = page.locator("[data-cy='pay-buttons']");
      await page.locator("[data-cy='pay-zelle-copy']").waitFor({
        timeout: 15_000,
      });
      const text = (await block.innerText()).replace(/\s+/g, " ").trim();
      expect.eq(
        banned.test(text),
        false,
        `${lang}: only a Zelle send-to card, nothing paid online, yet the pay block reads "${text}"`,
      );
    }
  }));
