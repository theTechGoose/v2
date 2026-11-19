/**
 * REQ-987 (LOOP-007 q1, q1-69) — on a Spanish account the New invoice form's
 * service picker (ServiceSelect → SearchSelect, REQ-921/136) speaks Spanish:
 * typing a name that is no service shows "Sin coincidencias." (common.noMatches),
 * not "No matches", and the × that clears the box is not labelled "Clear".
 * The tester's steps: Enviar factura, type "Reparación de goteras" into
 * "Busca un servicio…".
 */
import { story, type StoryTools } from "#shots";
import { ensureService } from "../_shared/service-lines.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signInSpanish(
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
    body: JSON.stringify({ language: "es", name: "Cuenta Española" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-987 (q1-69): on a Spanish account the New invoice service picker says 'Sin coincidencias.' and its clear button is not labelled 'Clear'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signInSpanish(http, page, baseUrl);
    await ensureService(http, auth, "Corte de césped");

    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );

    const svc0 = "[data-cy='new-invoice-line-service-0']";
    const box = page.locator(`${svc0} [data-cy='search-select-input']`);
    await box.waitFor({ timeout: 15_000 });
    expect.eq(
      await box.getAttribute("placeholder"),
      "Busca un servicio…",
      "the form is the Spanish one (placeholder already localized)",
    );

    await box.click();
    await box.fill("Reparación de goteras");
    const empty = page.locator(`${svc0} [data-cy='search-select-empty']`);
    await empty.waitFor({ timeout: 10_000 });
    expect.eq(
      (await empty.innerText()).trim(),
      "Sin coincidencias.",
      "the empty row is in Spanish",
    );

    const clear = page.locator(`${svc0} [data-cy='search-select-clear']`);
    await clear.waitFor({ timeout: 10_000 });
    const label = (await clear.getAttribute("aria-label")) ?? "";
    expect(label.length > 0, "the clear button has an aria-label");
    expect(
      label !== "Clear",
      `the clear button's aria-label is Spanish (got "${label}")`,
    );
  }));
