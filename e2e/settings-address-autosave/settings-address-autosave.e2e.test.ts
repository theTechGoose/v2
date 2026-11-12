/**
 * REQ-516 — demo-loop cycle 3, demo issue p8-pair6-b: "'se guardan al instante' next to a
 * 'Guardar dirección' button". In a browser, in Spanish: /settings says changes save instantly,
 * so the mailing-address card shows no Save button; typing a street and leaving the field shows
 * the card's "Guardado ✓" status, and the street is still there after a reload.
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
    body: JSON.stringify({ language: "es", name: "Address Autosave Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
}

const CARD = "[data-cy='settings-mailing-address']";

Deno.test("REQ-516: the /settings mailing-address card has no Save button — it autosaves and shows Guardado ✓", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/settings");
    const card = page.locator(CARD);
    await card.waitFor({ timeout: 20_000 });

    expect.eq(
      await page.locator(".hero__sub").first().innerText(),
      "Actualiza los datos de tu negocio abajo — se guardan al instante.",
      "ES hero promises instant save",
    );
    expect.eq(
      await card.locator("button").count(),
      0,
      "the mailing-address card renders no button",
    );
    expect.eq(
      await page.getByText(/guardar dirección|save address/i).count(),
      0,
      "no 'Guardar dirección' anywhere on the page",
    );

    // Typing before hydration is lost — retry until the autosave status shows up.
    const street = card.locator("input").first();
    let savedSeen = false;
    for (let attempt = 0; attempt < 10 && !savedSeen; attempt++) {
      await street.fill("");
      await street.pressSequentially("742 Evergreen Ter");
      await street.blur();
      for (let i = 0; i < 15 && !savedSeen; i++) {
        savedSeen = (await card.getByText("Guardado").count()) > 0;
        if (!savedSeen) await page.waitForTimeout(200);
      }
    }
    expect(
      savedSeen,
      "the card shows its 'Guardado ✓' status after leaving the field",
    );

    await page.reload();
    await card.waitFor({ timeout: 20_000 });
    expect.eq(
      await card.locator("input").first().inputValue(),
      "742 Evergreen Ter",
      "the street persisted without pressing any Save button",
    );
  }));
