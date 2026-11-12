/**
 * REQ-545 (demo-loop cycle 4, m2) — the customer's demo pill yields to the page: with anything of
 * the page under its home (a phone page's cards past the fold, the onboarding wizard) it folds to
 * a small tab on the window's left edge (`data-tucked`) and its status, End and details are not
 * shown. The link's state is always on the pill (`data-status`: live, connecting, ended).
 *
 * `pillUp` brings the WHOLE pill out for a story that reads or clicks it, the way a person would:
 * the page to its end (the band there is free, so the pill sits home), and if it is still folded
 * (a page whose end is not free), a hover on its tab and the pointer kept on the pill.
 */

/** the customer's pill is whole on `pg` (and, with `live`, its link is up) */
export async function pillUp(
  // deno-lint-ignore no-explicit-any
  pg: any,
  o: { live?: boolean; timeout?: number } = {},
) {
  const timeout = o.timeout ?? 20_000;
  await pg.locator(
    o.live
      ? "[data-cy='demo-pill'][data-status='live']"
      : "[data-cy='demo-pill']",
  ).waitFor({ state: "attached", timeout });
  await pg.evaluate(() =>
    scrollTo(0, document.scrollingElement?.scrollHeight ?? 0)
  );
  // the pill is placed again within a check (PILL_CHECK_MS) of the scroll
  await pg.waitForTimeout(1_000);
  const whole = pg.locator("[data-cy='demo-pill']:not([data-tucked])");
  await whole.waitFor({ state: "attached", timeout: 3_000 }).catch(async () => {
    // a real pointer onto the tab: the pill unfolds under it, flush with the edge; along it a
    // little, so the pointer is on the whole pill (it stays whole until the pointer leaves)
    const tab = await pg.locator("[data-cy='demo-pill-tab']").boundingBox();
    if (!tab) throw new Error("pillUp: the pill is folded but has no tab");
    const y = tab.y + tab.height / 2;
    await pg.mouse.move(tab.x + tab.width / 2, y, { steps: 4 });
    await pg.mouse.move(tab.x + tab.width / 2 + 30, y, { steps: 4 });
  });
  await pg.locator("[data-cy='demo-pill'] [data-cy='demo-status']").waitFor({
    timeout,
  });
}
