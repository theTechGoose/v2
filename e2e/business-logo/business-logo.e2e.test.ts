/**
 * REQ-628 — A2Z Landscape feedback relayed by Raphael, 2026-11-12: "They NEED THEIR LOGO NOT
 * OURS". In a browser, the pages their customer opens — the invoice (/i/:id) and the quote +
 * agreement (/q/:id) — show the business's uploaded logo (loaded, inside its box) or, with no
 * logo on file, the business name as a wordmark; the tab names the business; nothing on the
 * page shows the DocuMonster logo or says "DocuMonster".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
// a 64x16 (4:1) PNG — wide, like most real logos
const WIDE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAIAAAAphe5+AAAANklEQVR4nGMQqdCgKTphI0dTxDDqgdEYGE1Co5l4tBQaLUZHK7LRmni0KTHamBttjdqQ2ZwGAKHyrC7T+OXQAAAAAElFTkSuQmCC";

async function verify(http: StoryTools["http"], phone: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  return { ...JSON_HEADERS, cookie };
}

async function call(
  http: StoryTools["http"],
  path: string,
  auth: Record<string, string>,
  method: string,
  body: unknown,
) {
  const r = await http(path, { method, headers: auth, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return await r.json();
}

/** a contractor with a business name, a customer, a quote and an invoice — and the logo if asked */
async function seed(http: StoryTools["http"], biz: string, withLogo: boolean) {
  const auth = await verify(http, `+1512${digits()}`);
  await call(http, "/api/me", auth, "PUT", { language: "en", name: "Alexander Jerez" });
  let logoFileId: string | undefined;
  if (withLogo) {
    const f = await call(http, "/api/files", auth, "POST", {
      filename: "logo.png",
      mimeType: "image/png",
      base64: WIDE_PNG_B64,
    });
    logoFileId = f.id;
  }
  await call(http, "/api/profile/identity", auth, "PUT", {
    businessName: biz,
    ...(logoFileId ? { logoFileId } : {}),
  });
  const customer = await call(http, "/api/customers", auth, "POST", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  const invoice = await call(http, "/api/invoices", auth, "POST", {
    customerId: customer.id,
    status: "sent",
    jobName: "October maintenance",
    amount: 6500,
  });
  const quote = await call(http, "/api/quotes", auth, "POST", {
    customerId: customer.id,
    summary: "Fall cleanup",
    lineItems: [{ description: "Leaf removal", quantity: 1, unit: "ea", price: 20000 }],
  });
  return { invoiceId: invoice.id as string, quoteId: quote.id as string };
}

async function assertNoDocuMonster(page: StoryTools["page"], expect: StoryTools["expect"], where: string) {
  const text = await page.evaluate(() => document.body.innerText);
  expect.eq(/DocuMonster/i.test(text), false, `${where}: the page never says DocuMonster`);
  const ours = await page.locator(
    "img[src$='/logo.png'], img[src$='/logo-monster.png'], img[src$='/logo-email.png']",
  ).count();
  expect.eq(ours, 0, `${where}: no DocuMonster logo image`);
  expect.eq(/DocuMonster/i.test(await page.title()), false, `${where}: the tab title`);
}

Deno.test("REQ-628: the invoice and quote pages show the business's own logo (loaded, kept in its box) and never DocuMonster; the tab names the business", (t) =>
  story(t, async ({ page, expect, http }) => {
    const biz = "A2Z Landscape LLC";
    const { invoiceId, quoteId } = await seed(http, biz, true);

    for (const [where, path] of [["/i", `/i/${invoiceId}`], ["/q", `/q/${quoteId}`]] as const) {
      await page.goto(path);
      const logo = page.locator("[data-cy='biz-logo']").first();
      await logo.waitFor({ timeout: 20_000 });
      // loaded, and scaled into the 200x64 box at its own 4:1 ratio
      await page.waitForFunction(() => {
        const img = document.querySelector<HTMLImageElement>("[data-cy='biz-logo']");
        return !!img && img.complete && img.naturalWidth > 0;
      }, undefined, { timeout: 10_000 });
      const box = await logo.evaluate((el) => {
        const r = (el as HTMLImageElement).getBoundingClientRect();
        return { w: r.width, h: r.height, natural: (el as HTMLImageElement).naturalWidth };
      });
      expect.eq(box.natural, 64, `${where}: the uploaded logo is what loaded`);
      expect(box.w <= 200 && box.h <= 64, `${where}: inside the box (${box.w}x${box.h})`);
      expect(Math.abs(box.w / box.h - 4) < 0.1, `${where}: aspect ratio kept (${box.w}x${box.h})`);
      expect.eq(await page.locator("[data-cy='biz-wordmark']").count(), 0, `${where}: the logo, not the wordmark`);
      await assertNoDocuMonster(page, expect, where);
      expect((await page.title()).includes(biz), `${where}: the tab names ${biz}`);
    }
  }));

Deno.test("REQ-628: with no logo on file the invoice and quote pages head with the business name as a wordmark — never the DocuMonster logo", (t) =>
  story(t, async ({ page, expect, http }) => {
    const biz = "Green Acres Lawn Co";
    const { invoiceId, quoteId } = await seed(http, biz, false);
    for (const [where, path] of [["/i", `/i/${invoiceId}`], ["/q", `/q/${quoteId}`]] as const) {
      await page.goto(path);
      const mark = page.locator("[data-cy='biz-wordmark']").first();
      await mark.waitFor({ timeout: 20_000 });
      expect.eq((await mark.innerText()).trim(), biz, `${where}: the wordmark is the business name`);
      expect.eq(await page.locator("[data-cy='biz-logo']").count(), 0, `${where}: no logo image`);
      await assertNoDocuMonster(page, expect, where);
    }
  }));
