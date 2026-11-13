/**
 * REQ-794 — /invoices offers two export links (all, unpaid), not three.
 * REQ-795 — Reports: a root sidebar row; pick a slice and a date range, the
 * download link's CSV holds only the rows in range; From after To is refused.
 * Raphael (hotfix, 2026-11-13): "just put 2 buttons, all invoices, all unpaid
 * invoices ... make a data export section at the top level ... select what
 * slice of data we want and for what dates" / "call it reports".
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Rita Reports",
    businessName: "Reports Co",
  });
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

Deno.test("REQ-794 + REQ-795: /invoices has two export links; Reports is a root sidebar row; on /reports Paid invoices + a custom range downloads only the invoice paid in range; From after To shows an error and disables the download", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const auth = await signIn(http, page, baseUrl);
    // a customer, one invoice paid in January 2026, one paid in March 2026
    const cust = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Ana Torres" }),
    })).json();
    const mk = async (amount: number, paidAt: string, issuedDate: string) =>
      await (await http("/api/invoices", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          customerId: cust.id,
          amount,
          status: "paid",
          paidAt,
          issuedDate,
          dueDate: issuedDate,
        }),
      })).json();
    const jan = await mk(10000, "2026-01-15T12:00:00.000Z", "2026-01-05");
    const mar = await mk(20000, "2026-03-31T12:00:00.000Z", "2026-03-01");
    expect(!!jan.id && !!mar.id, `two invoices (${JSON.stringify(jan)})`);

    // 1. /invoices: exactly two export links, no year link
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/invoices");
    await page.locator("[data-cy='invoice-export-all']").waitFor({
      timeout: 30_000,
    });
    expect(
      await page.locator("[data-cy='invoice-export-unpaid']").count() === 1,
      "the unpaid export link",
    );
    expect(
      await page.locator("[data-cy='invoice-export']").count() === 0,
      "no third (year) export link",
    );
    expect(
      await page.locator(".qph__cta-row a[href*='export.csv']").count() === 2,
      "two export links in the CTA row",
    );
    await page.screenshot({ path: `${folder}/invoices-two-exports.png` });

    // 2. Reports on the sidebar root (on /invoices the rail rests inside
    // Billing — Back climbs to the root, REQ-176)
    const nav = page.locator(".sb__nav");
    await nav.locator("[data-cy='nav-back']").click();
    const reports = nav.locator("a.nav-item[href='/reports']");
    await reports.waitFor({ timeout: 20_000 });
    const root = (await nav.locator(".nav-item__label").allInnerTexts()).map(
      (x) => x.trim(),
    );
    expect(
      root[root.length - 1] === "Reports",
      `Reports is the last root row (${root.join(" | ")})`,
    );
    await reports.click();
    await page.waitForURL(/\/reports/, { timeout: 20_000 });
    await page.locator("[data-cy='reports-page']").waitFor({ timeout: 20_000 });
    await nav.locator("a.nav-item--active[href='/reports']").waitFor({
      timeout: 20_000,
    });

    // 3. Paid invoices + custom Jan 1 → Mar 30: the link's CSV holds January only
    await page.locator("[data-cy='report-slice-paid']").click();
    await page.locator("[data-cy='report-preset-custom']").click();
    await page.locator("[data-cy='report-from']").fill("2026-01-01");
    await page.locator("[data-cy='report-to']").fill("2026-03-30");
    const link = page.locator("a[data-cy='report-download']");
    await link.waitFor({ timeout: 10_000 });
    const href = await link.getAttribute("href");
    expect.eq(
      href,
      "/api/invoices/export.csv?status=paid&from=2026-01-01&to=2026-03-30",
      "the download link",
    );
    const res = await http(href!, { headers: auth });
    expect.eq(res.status, 200, "the CSV answers");
    const lines = (await res.text()).replace(/^﻿/, "").split("\r\n");
    expect.eq(
      lines.length,
      2,
      `header + the January invoice (${lines.join(" / ")})`,
    );
    expect(lines[1].startsWith("INV-001,"), lines[1]);
    await page.screenshot({ path: `${folder}/reports-paid-custom.png` });

    // 4. To before From: the error shows and the download is disabled
    await page.locator("[data-cy='report-to']").fill("2025-12-31");
    await page.locator("[data-cy='report-range-error']").waitFor({
      timeout: 10_000,
    });
    expect(
      await page.locator("a[data-cy='report-download']").count() === 0,
      "no live download link while the range is invalid",
    );
    await page.screenshot({ path: `${folder}/reports-bad-range.png` });

    // 5. a preset puts the link back; All time has no from/to
    await page.locator("[data-cy='report-preset-all']").click();
    await link.waitFor({ timeout: 10_000 });
    expect.eq(
      await link.getAttribute("href"),
      "/api/invoices/export.csv?status=paid",
      "All time: no range",
    );
  }));
