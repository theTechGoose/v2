/**
 * REQ-1002 (LOOP-007 q1-89, amends REQ-887) — a contractor adds a department and never meets the
 * call-centre "Division: Inbound / Outbound" field: the Add department modal asks only for the
 * name, the configure page has no division select, and the table has no Division column.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "Dept Story",
      email: "dept-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Ridge Roofing" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`clickUntil: ${selector} never had its effect`);
}

Deno.test("REQ-1002: Add department asks only for the name — no Inbound/Outbound division on the modal, the configure page or the table", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/hr/departments");
    await clickUntil(
      page,
      "[data-cy='hr-dept-add']",
      async () => await page.locator("[data-cy='hr-dept-modal']").isVisible(),
    );
    const modal = await page.evaluate(() => {
      const m = document.querySelector("[data-cy='hr-dept-modal']")!;
      return {
        divisionSelect: !!m.querySelector("[data-cy='hr-dept-new-division']"),
        selects: m.querySelectorAll("select").length,
        options: [...m.querySelectorAll("option")].map((o) =>
          o.textContent?.trim()
        ),
        text: (m as HTMLElement).innerText,
      };
    });
    expect.eq(
      modal.divisionSelect,
      false,
      "no division select on the Add department modal",
    );
    expect.eq(
      modal.selects,
      0,
      "the Add department form has only the name field",
    );
    // expect.eq is ===, so arrays are compared as JSON (REQ-1002 test fix)
    expect.eq(
      JSON.stringify(modal.options),
      "[]",
      "no Inbound/Outbound options",
    );
    expect.eq(
      /Division|Inbound|Outbound/.test(modal.text),
      false,
      `modal text has no call-centre words: ${modal.text}`,
    );

    await page.locator("[data-cy='hr-dept-new-name']").fill("Roofing crew");
    await page.locator("[data-cy='hr-dept-create']").click();
    await page.locator("[data-cy='hr-dept-cfg-name']").waitFor({
      timeout: 15_000,
    });
    const cfg = await page.evaluate(() => {
      const opts = [...document.querySelectorAll("option")].map((o) =>
        o.getAttribute("value")
      );
      return {
        divisionOptions: opts.filter((v) =>
          v === "inbound" || v === "outbound"
        ),
        text: document.body.innerText,
      };
    });
    expect.eq(
      JSON.stringify(cfg.divisionOptions),
      "[]",
      "no inbound/outbound select on the configure page",
    );
    expect.eq(
      /\bDivision\b|\bInbound\b|\bOutbound\b/.test(cfg.text),
      false,
      "configure page has no Division / Inbound / Outbound",
    );

    await page.locator("[data-cy='hr-dept-back']").click();
    await page.locator("[data-cy='hr-dept-row']").first().waitFor({
      timeout: 15_000,
    });
    const table = await page.evaluate(() => ({
      headers: [...document.querySelectorAll("[data-cy='hr-depts'] th")].map(
        (th) => th.textContent?.trim() ?? "",
      ),
      row: (document.querySelector("[data-cy='hr-dept-row']") as HTMLElement)
        .innerText,
    }));
    expect.eq(
      table.headers.includes("Division"),
      false,
      `no Division column: ${table.headers.join(" | ")}`,
    );
    expect.eq(
      /Inbound|Outbound/.test(table.row),
      false,
      `no Inbound/Outbound chip in the row: ${table.row}`,
    );
  }));
