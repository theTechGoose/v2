/**
 * REQ-511 — demo-loop cycle 3, issues m41 + p8-pair6-d, on the real shell at 1280×800.
 *
 * m41: the demo picked a .txt as the logo and saw "no error, no request, the old logo stays" —
 * the refusal was drawn at the very bottom of the Edit details card, under the languages and the
 * time zone, off-screen. Here the refusal shows in the logo row, on screen, right by the button,
 * and the format + 8 MB hint is still there with a logo already set ("Replace logo").
 * p8-pair6-d: replacing the logo (or any Edit details save) never said "Saved". Here a real PNG
 * replace ends with "Saved" in the card's header.
 */
import { Buffer } from "node:buffer";
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const REFUSAL = "That file is not an image. Pick a PNG, JPG, GIF or WebP logo.";

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

Deno.test("REQ-511 m41 + p8-pair6-d: a .txt logo is refused in the logo row, on screen; the type + 8 MB hint stays on Replace; a PNG replace says Saved", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth); // a logo is already on record
    const logoOf = async () =>
      (await (await http("/api/profile/identity", { headers: auth })).json())
        .logoFileId as string;
    const realLogo = await logoOf();

    await page.goto("/settings");
    await page.locator("[data-cy='settings-logo-preview']").waitFor({
      timeout: 15_000,
    });
    const card = page.locator("[data-cy='settings-edit-details']");
    const button = card.getByRole("button", { name: /logo/i });
    await expect.see("Replace logo");

    // the hint stays with a logo set: every accepted type and the size limit
    const hint = page.locator("[data-cy='settings-logo-hint']");
    await hint.waitFor({ timeout: 15_000 });
    const hintText = (await hint.textContent()) ?? "";
    for (const s of ["PNG", "JPG", "GIF", "WebP", "8 MB"]) {
      expect(
        hintText.includes(s),
        `the Replace-logo hint names ${s} (got "${hintText}")`,
      );
    }

    const input = page.locator("[data-cy='settings-logo-file']");
    const logoErr = page.locator("[data-cy='settings-logo-error']");
    // the island may not be hydrated on the first set: pick again until the refusal shows
    let shown = false;
    for (let attempt = 0; attempt < 10 && !shown; attempt++) {
      await input.setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a logo\n"),
      });
      for (let i = 0; i < 10 && !shown; i++) {
        shown = await logoErr.isVisible().catch(() => false);
        if (!shown) await page.waitForTimeout(200);
      }
    }
    expect(
      shown,
      "the .txt refusal shows in the logo row ([data-cy=settings-logo-error])",
    );
    expect.eq(
      (await logoErr.textContent())?.trim(),
      REFUSAL,
      "the logo row says why",
    );
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox();
    const e = await logoErr.boundingBox();
    expect(!!b && !!e, "button and refusal both laid out");
    expect(
      e!.y - (b!.y + b!.height) < 80 && e!.y >= b!.y,
      `the refusal sits right under the logo button (button bottom ${
        b!.y + b!.height
      }, error top ${e!.y})`,
    );
    expect(e!.y + e!.height <= 800, "the refusal is on screen with the button");
    expect.eq(await logoOf(), realLogo, "the .txt never became the logo");

    // a real PNG replace — the card says Saved, and the refusal goes away
    await input.setInputFiles({
      name: "new-logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await card.getByText("Saved").waitFor({ timeout: 15_000 });
    expect(
      !(await logoErr.isVisible().catch(() => false)),
      "the old refusal is cleared by a good pick",
    );
    expect((await logoOf()) !== realLogo, "the new PNG is the logo on record");
  }));
