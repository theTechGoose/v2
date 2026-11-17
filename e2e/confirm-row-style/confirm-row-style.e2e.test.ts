/**
 * REQ-707 — demo-loop cycle 5 (run r37f88707), issue m61: "'No lo recibí'
 * confirm has unstyled browser buttons and text past the card padding". In a
 * browser, on a claimed invoice card's back face, the reject ask and the
 * nudge ask show an outlined Yes and a ghost No (not the browser's grey
 * buttons), and their text starts at the same inset as the card body.
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
    body: JSON.stringify({ language: "en", name: "Rosa Story" }),
  });
  await me.body?.cancel();
  const identity = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Rosa Co",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "rosa-707@zelle.test" },
      },
    }),
  });
  await identity.body?.cancel();
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

type Look = {
  yesBg: string;
  yesBorder: string;
  yesBorderColor: string;
  noBg: string;
  noBorder: string;
  askLeft: number;
  cardLeft: number;
  bodyTextLeft: number;
};

Deno.test("REQ-707 m61: the claimed card's reject and nudge asks have house-styled buttons and sit inside the card's padding", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Lopez",
        email: "maria@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Gate repair REQ-707",
        description: "Gate repair",
        lineItems: [{ description: "Gate repair", quantity: 1, price: 25000 }],
        amount: 25000,
        dueDate: "2026-12-20",
      }),
    })).json();
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle" }),
    });
    expect.eq(claim.status, 200, "the customer's claim is recorded");
    await claim.body?.cancel();

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Gate repair REQ-707",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    await card.click(); // flip to the back face

    const measure = (cy: string) =>
      page.evaluate((cy: string) => {
        const ask = document.querySelector(`[data-cy='${cy}']`) as HTMLElement;
        const card = ask.closest(".qcard") as HTMLElement;
        const body = card.querySelector(".qcard__back-body") as HTMLElement;
        const yes = document.querySelector(`[data-cy='${cy}-yes']`)!;
        const no = document.querySelector(`[data-cy='${cy}-no']`)!;
        const span = ask.querySelector("span") as HTMLElement;
        const ys = getComputedStyle(yes);
        const ns = getComputedStyle(no);
        return {
          yesBg: ys.backgroundColor,
          yesBorder: ys.borderTopStyle + " " + ys.borderTopWidth,
          yesBorderColor: ys.borderTopColor,
          noBg: ns.backgroundColor,
          noBorder: ns.borderTopStyle,
          askLeft: span.getBoundingClientRect().left,
          cardLeft: card.getBoundingClientRect().left,
          bodyTextLeft: body.getBoundingClientRect().left +
            parseFloat(getComputedStyle(body).paddingLeft),
        };
      }, cy);

    const check = (what: string, l: Look, yesColor: RegExp) => {
      expect.eq(l.yesBg, "rgb(255, 255, 255)", `${what} Yes is white`);
      expect.eq(l.yesBorder, "solid 1px", `${what} Yes is outlined`);
      expect(
        yesColor.test(l.yesBorderColor),
        `${what} Yes outline is the house colour (${l.yesBorderColor})`,
      );
      expect.eq(l.noBg, "rgba(0, 0, 0, 0)", `${what} No is ghost`);
      expect.eq(l.noBorder, "none", `${what} No has no border`);
      expect(
        Math.abs(l.askLeft - l.bodyTextLeft) <= 1 &&
          l.askLeft - l.cardLeft >= 16,
        `${what} text lines up with the card body (ask ${l.askLeft}, body ${l.bodyTextLeft}, card ${l.cardLeft})`,
      );
    };

    await card.locator("[data-cy='invoice-reject-claim']").click();
    await card.locator("[data-cy='invoice-reject-ask']").waitFor({
      timeout: 15_000,
    });
    // coral: --brand-pink
    check(
      "reject",
      await measure("invoice-reject-ask"),
      /^rgb\(255, 107, 107\)$/,
    );
    await card.locator("[data-cy='invoice-reject-ask-no']").click();
    await card.locator("[data-cy='invoice-reject-ask']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });

    await card.locator("[data-cy='invoice-nudge']").click();
    await card.locator("[data-cy='invoice-nudge-ask']").waitFor({
      timeout: 15_000,
    });
    // teal: --brand-teal
    check("nudge", await measure("invoice-nudge-ask"), /^rgb\(26, 83, 92\)$/);
  }));
