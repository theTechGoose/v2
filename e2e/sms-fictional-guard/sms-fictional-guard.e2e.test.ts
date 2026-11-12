/**
 * REQ-523 — demo-loop cycle 3, issue m16: "The app says texts were sent to
 * numbers that can't get texts." In a browser, on the stack the demo ran on
 * (SMS in dev mode):
 *  - pair 7 invited Carol Miller at (512) 555-0199 on /admins and read "We
 *    texted (512) 555-0199 an invite";
 *  - pair 2 added the worker Luis Gómez at (305) 555-0123 and read "Le
 *    mandamos a Luis Gómez el enlace para entrar y su PIN por texto.";
 *  - pair 9's customer (5125550142, no email) claimed Zelle on /i and read
 *    "we'll text you a receipt then."
 * Every one of those numbers is in the reserved 555-01XX block.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the owner signs in (dev code), English, Zelle accepted; the page is theirs */
async function owner(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1843${digits()}`;
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
  for (
    const [path, payload] of [
      ["/api/me", { language: "en", name: "Hank Miller" }],
      ["/api/profile/identity", {
        businessName: "Miller Electric",
        acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
      }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  await asVisitor(page, baseUrl, cookie);
  return { auth };
}

/** the browser carries `cookie` (or no session at all) and English */
async function asVisitor(
  page: StoryTools["page"],
  baseUrl: string,
  cookie?: string,
) {
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().clearCookies();
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      ...(cookie
        ? [{
          name: cookie.split("=")[0],
          value: cookie.split("=")[1],
          domain,
          path: "/",
        }]
        : []),
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** type into a form until its submit button is enabled — a fill that lands
 *  before the island hydrates is wiped by the first render */
async function fillUntilEnabled(
  page: StoryTools["page"],
  fields: [string, string][],
  submit: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const [sel, value] of fields) {
      await page.locator(sel).fill(value);
    }
    if (await page.locator(submit).isEnabled()) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${submit} never enabled`);
}

Deno.test("REQ-523 m16: an editor invite and a worker welcome to a 555-01XX number say they could not text it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await owner(http, page, baseUrl);

    // pair 7: the editor invite
    await page.goto("/admins");
    await fillUntilEnabled(page, [
      ["[data-cy='adm-phone']", "5125550199"],
      ["[data-cy='adm-name']", "Carol Miller"],
    ], "[data-cy='adm-invite']");
    const notice = page.locator("[data-cy='adm-sent']");
    await clickUntil(page, "[data-cy='adm-invite']", () => notice.isVisible());
    const said = await notice.innerText();
    expect(
      /couldn't text \(512\) 555-0199/i.test(said),
      `the invite says it could not text (${said})`,
    );
    expect(!/We texted/i.test(said), `no "We texted" claim (${said})`);
    expect.eq(
      await notice.getAttribute("data-texted"),
      "false",
      "the notice is the not-texted one",
    );

    // pair 2: the worker welcome
    await page.goto("/field/workers");
    await fillUntilEnabled(page, [
      ["[data-cy='wk-name']", "Luis Gómez"],
      ["[data-cy='wk-phone']", "3055550123"],
      ["[data-cy='wk-pin']", "1234"],
    ], "[data-cy='wk-add']");
    const wk = page.locator("[data-cy='wk-texted']");
    await clickUntil(page, "[data-cy='wk-add']", () => wk.isVisible());
    expect.eq(
      await wk.getAttribute("data-texted"),
      "false",
      "the add says the PIN was not texted",
    );
    await expect.see("We couldn't text Luis Gómez");
  }));

Deno.test("REQ-523 m16: a claim on /i never promises a text receipt to a number that can't get texts; a real number still gets the promise", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await owner(http, page, baseUrl);
    const invoiceFor = async (name: string, phoneNumber: string) => {
      const c = await post(http, auth, "/api/customers", { name, phoneNumber });
      return await post(http, auth, "/api/invoices", {
        customerId: c.id,
        status: "sent",
        jobName: `Panel upgrade REQ-523 ${name}`,
        description: "Panel upgrade",
        lineItems: [{ description: "Panel upgrade", quantity: 1, price: 9000 }],
        amount: 9000,
        dueDate: "2026-12-05",
      });
    };
    const garcia = await invoiceFor("Mrs Garcia", "5125550142");
    const real = await invoiceFor("Cy Real", "5124421234");

    // the customer opens the link — no session of the business's
    await asVisitor(page, baseUrl);
    const claim = async (id: string) => {
      await page.goto(`/i/${id}`);
      const submit = page.locator("[data-cy='claim-submit']");
      await clickUntil(
        page,
        "[data-cy='claim-method-zelle']",
        () => submit.isVisible(),
      );
      const thanks = page.locator("[data-cy='claim-thanks']");
      await clickUntil(
        page,
        "[data-cy='claim-submit']",
        () => thanks.isVisible(),
      );
      return await thanks.innerText();
    };

    const fictional = await claim(garcia.id);
    expect(
      !/text you a receipt/i.test(fictional),
      `no text-receipt promise to 555-0142 (${fictional})`,
    );
    expect(
      /show it as paid/i.test(fictional),
      `the page says where the answer will show (${fictional})`,
    );
    // after a reload the claimed note says the same
    await page.reload();
    await expect.see("will show it as paid");
    expect(
      !/text you a receipt/i.test(await page.locator("body").innerText()),
      "the claimed note promises no text receipt",
    );

    const textable = await claim(real.id);
    expect(
      /text you a receipt/i.test(textable),
      `a real number keeps the text promise (${textable})`,
    );
  }));
