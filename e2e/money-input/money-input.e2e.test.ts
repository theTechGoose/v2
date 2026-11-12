/**
 * REQ-280 — fix every issue the demo found; this one is demo issue M33: "Typed text in the amount
 * field gets reversed in the hidden input ('-50abc' shows $50.00, input value '50cba')".
 * The page: /dev/money-input (front-end/routes/dev/money-input.tsx → islands/MoneyInput.tsx, the
 * same island the assistant's price step mounts).
 */
import { story } from "#shots";

Deno.test("REQ-280: typing '-50abc' into the amount leaves the field holding '50' and reports 5000 cents; a digit after junk still lands in place", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/dev/money-input");
    const input = page.locator("input.mi__input");
    const cents = page.locator("[data-cy='money-input-cents']");
    await input.waitFor({ timeout: 15000 });
    // hydration: the harness line only reacts once the island is live
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLInputElement>("input.mi__input");
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    });

    await input.pressSequentially("-50abc", { delay: 40 });
    await expect.see("Cents: 5000");
    expect.eq(
      await input.inputValue(),
      "50",
      "the field holds what the odometer shows",
    );
    expect.eq(
      await input.evaluate((el: HTMLInputElement) => el.selectionStart),
      2,
      "the caret sits after the digits",
    );

    await input.pressSequentially("x7", { delay: 40 });
    await expect.see("Cents: 50700");
    expect.eq(
      await input.inputValue(),
      "507",
      "a digit typed after a dropped letter lands at the caret",
    );

    // REQ-293 (demo-loop cycle 1, p11): the rolling digits are decoration — every
    // odometer is aria-hidden, so AT reads the labelled input, not "0123456789"
    expect.eq(
      await page.evaluate(() => {
        const odos = Array.from(document.querySelectorAll(".odo"));
        return `${odos.length}/${
          odos.filter((o) => o.getAttribute("aria-hidden") === "true").length
        }`;
      }),
      "2/2",
      "REQ-293: both odometers are aria-hidden",
    );

    // a form posting name="amount" would send exactly this
    expect.eq(
      await page.evaluate(() =>
        (document.querySelector("input[name='amount']") as HTMLInputElement)
          .value
      ),
      "507",
      "the named field's value",
    );
  }));
