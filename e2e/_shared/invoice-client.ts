/**
 * REQ-801 — the New invoice client is a search box (SearchSelect), not a
 * <select>: type the client's name, click its row; the hidden
 * `customerId` input then carries the pick.
 */
// deno-lint-ignore no-explicit-any
type Page = any;

export async function pickInvoiceClient(
  page: Page,
  name: string,
  id: string,
): Promise<void> {
  const root = page.locator("[data-cy='new-invoice-client']");
  const box = root.locator("[data-cy='search-select-input']");
  const hidden = root.locator("input[name='customerId']");
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await hidden.inputValue().catch(() => "")) === id) return;
    try {
      await box.click({ timeout: 2_000 });
      await box.fill(name);
      await root.locator("[data-cy='search-select-option']")
        .filter({ hasText: name }).first().click({ timeout: 3_000 });
    } catch {
      // still hydrating: try again
    }
    await page.waitForTimeout(300);
  }
  if ((await hidden.inputValue()) !== id) {
    throw new Error(`new-invoice client ${name}: never picked`);
  }
}
