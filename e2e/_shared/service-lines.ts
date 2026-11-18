/**
 * REQ-921 — a line bills a service picked from the catalogue. What a story
 * does to put a service in the catalogue (through the app's own API) and to
 * fill one line of the New invoice / repeat-visit forms with it.
 */
type Http = (input: string, init?: RequestInit) => Promise<Response>;

// deno-lint-ignore no-explicit-any
type Page = any;

/** the service named `name` in the account's catalogue — made when missing */
export async function ensureService(
  http: Http,
  auth: Record<string, string>,
  name: string,
): Promise<{ id: string; name: string }> {
  const r = await http("/api/field/task-types", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name }),
  });
  if (r.status === 409) {
    await r.body?.cancel();
    const list = await (await http(
      `/api/field/task-types?q=${encodeURIComponent(name)}`,
      { headers: auth },
    )).json() as Array<{ id: string; name: string }>;
    const hit = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!hit) throw new Error(`service ${name}: 409 but not listed`);
    return hit;
  }
  if (!r.ok) throw new Error(`service ${name}: ${r.status} ${await r.text()}`);
  return await r.json();
}

/** REQ-921: pick `service` in the search picker under `root` — type its name, click its row */
async function pickIn(
  page: Page,
  root: string,
  service: { id: string; name: string },
): Promise<void> {
  const box = page.locator(`${root} [data-cy='search-select-input']`);
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await page.locator(root).getAttribute("data-value")) === service.id) {
      return;
    }
    try {
      await box.click({ timeout: 2_000 });
      await box.fill(service.name);
      await page.locator(`${root} [data-cy='search-select-option']`)
        .filter({ hasText: service.name }).first().click({ timeout: 3_000 });
    } catch {
      // still hydrating / the catalogue still loading: try again
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`${root}: ${service.name} never picked`);
}

/** New invoice: line `i` bills `service` at `price` dollars (the row must exist) */
export async function fillInvoiceLine(
  page: Page,
  i: number,
  service: { id: string; name: string },
  price: string,
): Promise<void> {
  await pickIn(page, `[data-cy='new-invoice-line-service-${i}']`, service);
  await page.locator(`[data-cy='new-invoice-line-price-${i}']`).fill(price);
}

/** repeat visit: add `service` at `price` dollars as one of the visit's rows */
export async function addVisitService(
  page: Page,
  service: { id: string; name: string },
  price: string,
): Promise<void> {
  await pickIn(page, "[data-cy='subs-service']", service);
  await page.locator("[data-cy='subs-price']").fill(price);
  await page.locator("[data-cy='subs-add-item']").click();
}

/** the picker's rows under `root`, in order (opens its list) */
export async function pickerRows(page: Page, root: string): Promise<string[]> {
  const box = page.locator(`${root} [data-cy='search-select-input']`);
  await box.click();
  await box.fill("");
  const rows = page.locator(`${root} [data-cy='search-select-label']`);
  await rows.first().waitFor({ timeout: 10_000 });
  const out = (await rows.allInnerTexts()).map((t: string) => t.trim());
  await box.press("Escape");
  return out;
}

/** the label the picker under `root` shows */
export async function pickerShows(page: Page, root: string): Promise<string> {
  return await page.locator(`${root} [data-cy='search-select-input']`)
    .inputValue();
}
