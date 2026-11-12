/**
 * REQ-252 (demo issue M30) — a non-image file is never accepted as the business logo.
 *
 * The demo picked a text file named "factura.pdf" in Settings' logo picker (setInputFiles goes
 * past the `accept` hint, as a picker's "All files" option does): it was accepted silently and
 * every customer document then drew a broken image. Here, on the real shell: Settings shows the
 * logo itself; a PDF is refused before any upload; text bytes claiming to be a PNG are refused by
 * the server; both times the real logo stays on record and still draws.
 */
import { Buffer } from "node:buffer";
import { story, type StoryTools } from "#shots";
import { answerQuestions, JSON_HEADERS } from "../_shared/onboarding-answers.ts";

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
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

const REFUSAL = "That file is not an image. Pick a PNG, JPG, GIF or WebP logo.";

Deno.test("REQ-252: Settings shows the logo itself; a PDF is refused before upload and text bytes posing as a PNG are refused by the server — the real logo stays and still draws", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth); // the logo answered with a real 1×1 PNG
    const logoOf = async () =>
      (await (await http("/api/profile/identity", { headers: auth })).json())
        .logoFileId as string;
    const realLogo = await logoOf();

    await page.goto("/settings");
    const preview = page.locator("[data-cy='settings-logo-preview']");
    await preview.waitFor({ timeout: 15_000 });
    const draws = () =>
      preview.evaluate((img: HTMLImageElement) =>
        new Promise<boolean>((resolve) => {
          if (img.complete) return resolve(img.naturalWidth > 0);
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
        })
      );
    expect(await draws(), "Settings draws the logo on record, not its file id");

    const input = page.locator("[data-cy='settings-logo-file']");
    const pick = async (name: string, mimeType: string, text: string) => {
      // the island may not be hydrated on the first set: pick again until the refusal shows
      for (let attempt = 0; attempt < 10; attempt++) {
        await input.setInputFiles({ name, mimeType, buffer: Buffer.from(text) });
        for (let i = 0; i < 10; i++) {
          if (await page.getByText(REFUSAL).isVisible().catch(() => false)) return;
          await page.waitForTimeout(200);
        }
      }
      throw new Error(`${name}: the refusal never showed`);
    };

    // the demo's file: text under a .pdf name, the browser reports application/pdf
    await pick("factura.pdf", "application/pdf", "Factura 001 — esto no es una imagen\n");
    await expect.see(REFUSAL);
    expect.eq(await logoOf(), realLogo, "the PDF never became the logo");

    // text bytes that claim to be a PNG get past the browser's type check — the server sniffs them
    await page.reload();
    await preview.waitFor({ timeout: 15_000 });
    await pick("logo.png", "image/png", "not a png at all");
    await expect.see(REFUSAL);
    expect.eq(await logoOf(), realLogo, "the fake PNG never became the logo");

    await page.reload();
    await preview.waitFor({ timeout: 15_000 });
    expect(await draws(), "the real logo still draws");
  }));
