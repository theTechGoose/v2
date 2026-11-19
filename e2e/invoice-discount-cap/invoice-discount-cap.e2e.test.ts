/**
 * REQ-981 (LOOP-007 cycle 1, q1-62) on the real shell — New invoice, a
 * Discount larger than the bill. The totals block showed
 * "Subtotal $0.00 / Discount −$100.00 / Tax $0.00 / Total $0.00": lines that
 * don't add up. The shown subtotal − discount + tax must equal the total, and
 * the discount line never shows more than the subtotal.
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
    body: JSON.stringify({ language: "en", name: "Discount Cap Story" }),
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

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** read every money line of the totals block in ONE evaluate (no read race) */
async function readTotals(page: StoryTools["page"]) {
  return await page.evaluate(() => {
    const box = document.querySelector("[data-cy='new-invoice-totals']");
    const cents = (s: string) =>
      Math.round(Number(s.replace(/[^0-9.]/g, "") || "0") * 100);
    const rows = [...(box?.children ?? [])].map((r) => ({
      label: (r.children[0]?.textContent ?? "").trim(),
      value: (r.children[1]?.textContent ?? "").trim(),
    }));
    const sub = box?.querySelector("[data-cy='new-invoice-subtotal']")
      ?.textContent ?? "";
    const tax = box?.querySelector("[data-cy='new-invoice-tax-cents']")
      ?.textContent ?? "";
    const total = box?.querySelector("[data-cy='new-invoice-total']")
      ?.textContent ?? "";
    const disc = rows.find((r) => r.value.startsWith("−"))?.value ?? "";
    return {
      text: (box?.textContent ?? "").replace(/\s+/g, " ").trim(),
      subtotal: cents(sub),
      discount: cents(disc),
      tax: cents(tax),
      total: cents(total),
    };
  });
}

async function typeInto(page: StoryTools["page"], cy: string, v: string) {
  const el = page.locator(`[data-cy='${cy}']`);
  await el.fill("");
  await el.fill(v);
}

Deno.test("REQ-981 q1-62: New invoice with Discount $100 and no amount never shows −$100.00 against a $0.00 total — the totals lines add up", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );

    // no amount, Discount 100
    await typeInto(page, "new-invoice-discount", "100");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-totals']")?.textContent ??
        "").includes("Total")
    );
    await page.waitForTimeout(300);
    const a = await readTotals(page);
    expect(
      !a.text.includes("−$100.00"),
      `REQ-981 no −$100.00 discount line with no amount (${a.text})`,
    );
    expect.eq(
      a.subtotal - a.discount + a.tax,
      a.total,
      `REQ-981 subtotal − discount + tax = total (${a.text})`,
    );

    // $50 amount, Discount 100, 8.25% tax — REQ-921 opens the form with one
    // service row, and Amount is read-only while a row exists; drop the
    // empty row so the one-amount bill can be typed.
    await page.locator("[data-cy='new-invoice-line-remove-0']").click();
    await typeInto(page, "new-invoice-amount", "50");
    await typeInto(page, "new-invoice-tax", "8.25");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-subtotal']")
        ?.textContent ?? "").includes("50.00")
    );
    await page.waitForTimeout(300);
    const b = await readTotals(page);
    expect(
      b.discount <= b.subtotal,
      `REQ-981 the discount line never exceeds the subtotal (${b.text})`,
    );
    expect.eq(
      b.subtotal - b.discount + b.tax,
      b.total,
      `REQ-981 subtotal − discount + tax = total (${b.text})`,
    );
  }));
