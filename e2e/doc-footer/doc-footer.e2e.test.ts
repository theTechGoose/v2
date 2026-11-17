/**
 * REQ-509 — demo-loop cycle 3, issue m24 ("fix every issue the demo found, loop
 * until there are none"): "Footer eats phone space and shows DocuMonster's
 * contact details on the contractor's documents".
 *  - The customer's quote (/q/:id) ends with the document footer: the policy
 *    links and "Powered by DocuMonster" — no DocuMonster phone or address.
 *  - On a 390x844 phone the app's compact footer is the links alone (the phone
 *    and the address are hidden), and on a short page (/work-orders, empty) it
 *    sits at the bottom of the screen, not mid-screen with blank space below.
 *
 *  - REQ-573 (cycle 4, p4-p3c): the quote doc already ends with "Powered by
 *    DocuMonster · Agreement …", so the page says it once — the footer drops
 *    its own credit.
 *
 * Pages: front-end/components/SiteFooterView.tsx, front-end/routes/q/[id].tsx,
 * front-end/static/dashboard.css.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** A signed-in, onboarded account on the page's browser context; returns its auth headers. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Footer User",
    businessName: "Footer Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
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
  if (r.status >= 400) {
    throw new Error(`${path}: ${r.status} ${await r.text()}`);
  }
  return await r.json();
}

interface Footer {
  document: boolean;
  links: number;
  text: string;
  /** visible (non-zero box) phone / address */
  phoneShown: boolean;
  addressShown: boolean;
  bottom: number;
  viewport: number;
}
function footer(page: StoryTools["page"]): Promise<Footer | null> {
  return page.evaluate(() => {
    const f = document.querySelector<HTMLElement>("[data-site-footer]");
    if (!f) return null;
    const shown = (sel: string) => {
      const el = f.querySelector<HTMLElement>(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      document: f.hasAttribute("data-site-footer-document"),
      links: f.querySelectorAll("[data-legal-link]").length,
      text: f.textContent ?? "",
      phoneShown: shown("[data-site-phone]"),
      addressShown: shown("[data-site-address]"),
      bottom: Math.round(f.getBoundingClientRect().bottom + scrollY),
      viewport: innerHeight,
    };
  });
}

Deno.test("REQ-509 (m24) REQ-573 (p4-p3c): the customer's quote ends with the document footer — policy links, no DocuMonster phone or address — and says Powered by DocuMonster once", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Linda Morales",
      phoneNumber: "+15125550199",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Deep clean",
      jobName: "Deep Clean",
      description: "Deep clean of a three-bedroom house",
      lineItems: [{
        description: "Deep clean",
        quantity: 1,
        unit: "job",
        price: 32000,
      }],
      estimatedTotal: 32000,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/q/${quote.id}`);
    await page.locator("[data-site-footer]").waitFor({ timeout: 15000 });
    const f = await footer(page);
    expect(f !== null, "the quote has a footer");
    expect(f!.document, "the quote's footer is the document variant");
    expect.eq(f!.links, 4, "the four policy links");
    expect(!f!.text.includes("855-362-8666"), "no DocuMonster phone");
    expect(!f!.text.includes("Socastee"), "no DocuMonster address");
    // REQ-573 (cycle 4, p4-p3c): the quote doc itself ends with "Powered by
    // DocuMonster · Agreement …", so the page says it once — not again in
    // the footer.
    await page.getByText("Powered by DocuMonster · Agreement").waitFor({
      timeout: 15000,
    });
    expect(
      !f!.text.includes("Powered by DocuMonster"),
      `the footer does not repeat the credit (got "${f!.text}")`,
    );
    const said = await page.evaluate(() =>
      (document.body.innerText.match(/Powered by DocuMonster/g) ?? []).length
    );
    expect.eq(said, 1, '"Powered by DocuMonster" appears once on the quote');
  }));

Deno.test("REQ-509 (m24): on a 390x844 phone the app's compact footer is the links alone and sits at the bottom of a short page (/work-orders)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/work-orders");
    await page.locator("[data-site-footer]").waitFor({ timeout: 15000 });
    const f = await footer(page);
    expect(f !== null, "the page has a footer");
    expect.eq(f!.links, 4, "the four policy links");
    expect(!f!.phoneShown, "the phone is hidden on a phone");
    expect(!f!.addressShown, "the address is hidden on a phone");
    // the empty list is short: the footer ends at the screen's bottom (or below it), never mid-screen
    expect(
      f!.bottom >= f!.viewport - 2,
      `the footer reaches the bottom of the screen (footer bottom ${
        f!.bottom
      }, viewport ${f!.viewport})`,
    );
  }));
