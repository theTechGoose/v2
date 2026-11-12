/**
 * REQ-329 — fix every issue the demo found (cycle 1); demo issue p15-13 (pair 7):
 * "presets $50/$100/$500/$1k/$5k — silly for an $18k job".
 * The page: /dev/money-input?anchor=<cents> mounts the same MoneyInput island the assistant's
 * price step mounts, with the anchor AsstChat would pass (the market tier's price).
 */
import { story } from "#shots";

Deno.test("REQ-329: /dev/money-input?anchor=1800000 renders $9k · $13.5k · $18k · $22.5k · $27k chips and $18k clicks through", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/dev/money-input?anchor=1800000");
    const chips = page.locator("button.mi__chip");
    await chips.first().waitFor({ timeout: 15000 });
    expect.eq(
      (await chips.allInnerTexts()).join(" "),
      "$9k $13.5k $18k $22.5k $27k",
      "the chips scale to the $18k anchor",
    );
    // hydration: click until the harness line reacts
    for (let i = 0; i < 20; i++) {
      await chips.nth(2).click();
      const txt = await page.locator("[data-cy='money-input-cents']")
        .innerText();
      if (txt.includes("Cents: 1800000")) break;
      await page.waitForTimeout(250);
    }
    await expect.see("Cents: 1800000");
  }));

Deno.test("REQ-329: /dev/money-input without an anchor keeps the fixed $50…$5k chips", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/dev/money-input");
    const chips = page.locator("button.mi__chip");
    await chips.first().waitFor({ timeout: 15000 });
    expect.eq(
      (await chips.allInnerTexts()).join(" "),
      "$50 $100 $500 $1k $5k",
      "no anchor → the fixed list",
    );
  }));
