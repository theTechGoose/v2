/**
 * REQ-136 — "lets make a search compoenet. its a drop down that lets me type and filters results so
 * i can select it. dont put it anywhere, just let me see it locally on a test page with 1000 rows."
 * The page: /dev/search-select (front-end/routes/dev/search-select.tsx → islands/SearchSelect.tsx).
 */
import { story } from "#shots";

Deno.test("REQ-136: a thousand rows — typing narrows the list to matches, the keyboard picks, the mouse picks, Escape closes", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/dev/search-select");
    await expect.see("1,000 rows");
    const input = page.locator("[data-cy='search-select-input']");
    const list = page.locator("[data-cy='search-select-list']");
    const options = page.locator("[data-cy='search-select-option']");

    await input.click();
    await list.waitFor({ state: "visible" });
    expect(
      (await options.count()) === 50,
      `the open list shows the first fifty (${await options.count()})`,
    );
    await expect.see("950 more");

    await input.fill("row 99");
    await page.waitForFunction(() =>
      document.querySelectorAll("[data-cy='search-select-option']").length < 50
    );
    const n = await options.count();
    expect(
      n === 11,
      `typing narrowed the list to the eleven "row 99…" rows (${n})`,
    );
    const labels = await options.allInnerTexts();
    expect(
      labels.every((l) => l.toLowerCase().includes("row 99")),
      `every row shown matches "row 99": ${labels.slice(0, 3).join(" | ")}`,
    );
    const first =
      (await options.first().locator("[data-cy='search-select-label']")
        .innerText()).trim();

    await input.press("ArrowDown");
    await input.press("Enter");
    await list.waitFor({ state: "hidden" });
    expect(
      (await input.inputValue()) === first,
      `Enter picked the highlighted row into the box (${await input
        .inputValue()} vs ${first})`,
    );
    await expect.see(`Picked: ${first}`);

    await input.fill("row 10");
    await list.waitFor({ state: "visible" });
    const second =
      (await options.nth(1).locator("[data-cy='search-select-label']")
        .innerText()).trim();
    await options.nth(1).click();
    await list.waitFor({ state: "hidden" });
    await expect.see(`Picked: ${second}`);

    await input.fill("zzzz-no-such-row");
    await expect.see("No matches");
    await input.press("Escape");
    await list.waitFor({ state: "hidden" });
  }));
