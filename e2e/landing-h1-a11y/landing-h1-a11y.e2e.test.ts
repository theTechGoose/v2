/**
 * REQ-349 — Raphael, 2026-11-12: "fix every issue the demo found, loop until there are none."
 * Demo issue p15-2 (demo-loop cycle 1): the landing ("/") headline read oddly to screen
 * readers — "We handle the quotes. contracts." in English (pair 1) and "…las cotizaciones. los
 * contratos." after switching to Spanish (pair 9) — because the rotating words were the <h1>'s
 * live text and both the leaving and the entering word are visible during the crossfade.
 *
 * The story samples the <h1>'s accessible name through two full rotor cycles' worth of steps
 * (every crossfade included) in English, switches to Spanish, and samples again: it must be the
 * one stable sentence every time.
 */
import { story, type StoryTools } from "#shots";

const DESKTOP = { width: 1280, height: 900 };
const EN = "You do the work. We handle the paperwork.";
const ES = "Tú haces el trabajo. Nosotros manejamos el papeleo.";

/** the <h1>'s accessible name, as the browser's accessibility tree computes it */
async function h1Name(page: StoryTools["page"]): Promise<string> {
  const snap = await page.locator(".hero h1").ariaSnapshot();
  const m = snap.match(/heading "([^"]*)"/);
  return m ? m[1].replace(/\s+/g, " ").trim() : `(no heading name in: ${snap})`;
}

/** sample the name every 150 ms for ~5 s — over two rotor steps (2.2 s apart) and their fades */
async function namesOverRotation(
  page: StoryTools["page"],
): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < 34; i++) {
    seen.add(await h1Name(page));
    await page.waitForTimeout(150);
  }
  return seen;
}

Deno.test("REQ-349 p15-2: the landing <h1> reads one stable sentence to a screen reader, in English and in Spanish, whatever the rotor shows", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=en");
    await expect.see("You do the work.");
    // the rotor is running (the script ticks every 2.2 s)
    await page.locator("#rotor-track .word.in").first().waitFor({
      timeout: 15_000,
    });

    const en = await namesOverRotation(page);
    expect(
      en.size === 1 && en.has(EN),
      `the English <h1> is always "${EN}" (heard: ${JSON.stringify([...en])})`,
    );
    expect(
      (await page.getByRole("heading", { level: 1, name: EN, exact: true })
        .count()) === 1,
      "getByRole finds the one level-1 heading by its full English sentence",
    );

    await page.locator(".lang-toggle button[data-lang='es']").click();
    await expect.see("Tú haces el trabajo.");
    const es = await namesOverRotation(page);
    expect(
      es.size === 1 && es.has(ES),
      `the Spanish <h1> is always "${ES}" (heard: ${JSON.stringify([...es])})`,
    );
  }));
