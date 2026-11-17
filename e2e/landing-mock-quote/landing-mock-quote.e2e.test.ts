/**
 * REQ-412 — demo-loop cycle 2 (run r561db6d4), demo issues m41 + p12:
 * "Landing hero quote doesn't add up ($4,200+$3,990+$1,950 shown as $10,990)"
 * and "Landing counter reads 'DOCUMENTOS ENVIADOS HASTA HOY 0'".
 *
 * In a browser on "/": every sample-quote mock adds up (hero card, hero phone
 * bubble, the Quote / Contract / Invoice showcase, the PhoneChat island card),
 * and the documents counter reads its real number before any scroll and, under
 * reduced motion, after one.
 */
import { story, type StoryTools } from "#shots";

const DESKTOP = { width: 1280, height: 900 };
type Page = StoryTools["page"];

/** "$ 4,200" / "− $ 2,500" → signed cents; non-money → null. */
const cents = (s: string): number | null => {
  if (!/\$/.test(s)) return null;
  const n = Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
  return /[−-]/.test(s) ? -n : n;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const texts = (page: Page, sel: string) => page.locator(sel).allTextContents();

Deno.test("REQ-412 m41: every sample-quote mock on / adds up to the total it shows", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=en");

    // hero document card: four rows + total
    const doc = (await texts(page, ".hs-doc__row strong")).map(cents);
    const docTotal = doc.pop()!;
    expect.eq(doc.length, 4, "the hero card lists all four lines");
    expect.eq(sum(doc as number[]), docTotal, "hero card rows = its total");

    // hero phone bubble: three rows + total
    const rich = (await texts(page, ".hs-bubble--rich strong")).map(cents);
    const richTotal = rich.pop()!;
    expect.eq(sum(rich as number[]), richTotal, "phone bubble rows = total");

    // the Quote / Contract / Invoice showcase (static script)
    const lineAmounts = async () =>
      (await texts(page, "#doc-lines .doc-line .amt")).map(cents).filter((
        x,
      ): x is number => x !== null);
    const firstTotal = async () =>
      cents((await texts(page, "#doc-totals .row span:last-child"))[0]);
    await page.locator("#doc-lines .doc-line").first().waitFor();
    expect.eq(
      sum(await lineAmounts()),
      await firstTotal(),
      "the Quote showcase's lines = its subtotal",
    );
    await page.locator('.doc-tab[data-doc="contract"]').click();
    expect.eq(
      sum(await lineAmounts()),
      await firstTotal(),
      "the Contract's payments = the contract value",
    );
    await page.locator('.doc-tab[data-doc="invoice"]').click();
    expect.eq(
      sum(await lineAmounts()),
      await firstTotal(),
      "the Invoice's lines = the balance due",
    );

    // the PhoneChat island's quote card
    const card = page.locator(".phone .quote-card").first();
    await card.scrollIntoViewIfNeeded();
    await card.waitFor({ state: "attached", timeout: 15_000 });
    const rows = (await card.locator(".row strong").allTextContents()).map(
      cents,
    );
    const total = cents(
      (await card.locator(".total span").allTextContents())[1] ?? "",
    );
    expect.eq(sum(rows as number[]), total, "the PhoneChat card rows = total");
  }));

Deno.test("REQ-412 p12: the documents counter reads its real number, never 0", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/?lang=es");
    const counter = page.locator("#doc-counter-num");
    // before any scroll (what a snapshot / text extraction reads)
    expect.eq(
      ((await counter.textContent()) ?? "").trim(),
      "48,217", // REQ-499: US-grouped in es too
      "the counter reads the real number before it is scrolled into view",
    );
    // reduced motion: scrolling to it never animates it down to 0
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?lang=es");
    await counter.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect.eq(
      ((await counter.textContent()) ?? "").trim(),
      "48,217", // REQ-499: US-grouped in es too
      "under reduced motion the counter holds the final number",
    );
    // full motion: it counts up and lands on the same number
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/?lang=en");
    await counter.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        document.getElementById("doc-counter-num")?.textContent === "48,217",
      undefined,
      { timeout: 10_000 },
    ).catch(() => {});
    expect.eq(
      ((await counter.textContent()) ?? "").trim(),
      "48,217",
      "after the count-up the counter lands on the real number",
    );
  }));
