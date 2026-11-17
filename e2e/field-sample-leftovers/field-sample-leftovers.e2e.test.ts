/**
 * REQ-363 — demo-loop cycle 1, issues p15-14 / p15-15 (pair 8): an Austin owner
 * adds "Miguel Torres" on /field/workers. His row's avatar reads "MT" (was "MI",
 * a slice of the full name), and the phone boxes on /field/workers and /admins
 * show the neutral (555) 123-4567 — never the Myrtle Beach sample (843) 555-0201.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-363: Miguel Torres's avatar reads MT; the worker and admin phone boxes show (555) 123-4567, no 843", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // an Austin owner, English
    const r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    expect(!!cookie, "the owner has a session");
    const auth = { ...JSON_HEADERS, cookie };
    const me = await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en", name: "Austin Owner" }),
    });
    await me.body?.cancel();

    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Miguel Torres",
        phoneNumber: `512${digits()}`,
        pin: "1234",
        language: "es",
      }),
    });
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();

    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name, value, domain, path: "/" },
        { name: "pm_lang", value: "en", domain, path: "/" },
      ]),
    );

    await page.goto("/field/workers");
    const row = page.locator("[data-cy='wk-row']").filter({
      hasText: "Miguel Torres",
    });
    await row.waitFor({ timeout: 15_000 });
    const avatar = (await row.locator("[aria-hidden='true']").first()
      .textContent())?.trim();
    expect(
      avatar === "MT",
      `Miguel Torres's avatar reads MT — got "${avatar}"`,
    );

    const wkPh = await page.locator("[data-cy='wk-phone']").getAttribute(
      "placeholder",
    );
    expect(
      wkPh === "(555) 123-4567",
      `the worker phone placeholder is (555) 123-4567 — got "${wkPh}"`,
    );

    await page.goto("/admins");
    const adm = page.locator("[data-cy='adm-phone']");
    await adm.waitFor({ timeout: 15_000 });
    const admPh = await adm.getAttribute("placeholder");
    expect(
      admPh === "(555) 123-4567",
      `the admin phone placeholder is (555) 123-4567 — got "${admPh}"`,
    );
    // the brand green #519843 is on every page, so look for the sample number itself
    const html = await page.content();
    expect(
      !/\(843\)|8435550201|555-0201/.test(html),
      "no (843) 555-0201 sample number on /admins",
    );
  }));
