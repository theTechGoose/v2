/**
 * REQ-529 (demo-loop cycle 3, issues p8-pair2-c + p8-pair8-b) — on the real /field/workers page,
 * a zone-less worker's card reads "Cubre" … "ninguna zona aún — …" with visible space between the
 * label and its value on a phone-width screen (the demo saw "CubreSin zona asignada…"), and the
 * value is lowercase so "Covers no zone yet" reads as one line.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Hank Field" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
  ]));
  const w = await http("/api/field/workers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    }),
  });
  if (w.status !== 201 && w.status !== 200) {
    throw new Error(`worker not created (${w.status})`);
  }
  await w.body?.cancel();
}

for (
  const [lang, label, value] of [
    ["es", "Cubre", "ninguna zona aún — asígnale una en Asignaciones"],
    ["en", "Covers", "no zone yet — assign one in Assignments"],
  ] as const
) {
  Deno.test(`REQ-529 demo cycle 3 p8-pair2-c + p8-pair8-b: ${lang} phone, ${label} keeps space before its lowercase no-zone value`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await signIn(http, page, baseUrl, lang);
      await page.goto("/field/workers");
      const link = page.locator("[data-cy='wk-covers-none']").first();
      await link.waitFor({ timeout: 15_000 });
      const row = link.locator("xpath=ancestor::div[1]");
      const labelBox = await row.locator(":scope > span").first().boundingBox();
      const linkBox = await link.boundingBox();
      expect(
        (await row.locator(":scope > span").first().innerText()).trim() ===
          label,
        `the row's label is "${label}"`,
      );
      if (!labelBox || !linkBox) throw new Error("label/value not laid out");
      const space = linkBox.x - (labelBox.x + labelBox.width);
      expect(
        space >= 12,
        `at least 12px between "${label}" and its value (got ${
          space.toFixed(1)
        }px)`,
      );
      expect.eq((await link.innerText()).trim(), value, "the no-zone value");
    }));
}
