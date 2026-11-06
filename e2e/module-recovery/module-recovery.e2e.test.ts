/**
 * REQ-189 — a page whose island code fails to load reloads itself once and comes back alive: the
 * first request for the login island is made to fail (as a stale cached copy importing a deleted
 * module does); the shell's recovery script refetches the modules and reloads; the second load
 * works, the form is live, and the once-per-session guard is set.
 */
import { story } from "#shots";

Deno.test("REQ-189: the login island fails to load once — the page reloads itself once and the form is live", (t) =>
  story(t, async ({ page, expect }) => {
    // the island's requests fail for the FIRST page load only (a modulepreload and the import
    // may both ask for it); from the reload on they go through
    let navs = 0;
    page.on("framenavigated", (f: { parentFrame(): unknown }) => {
      if (f.parentFrame() === null) navs++;
    });
    let failed = 0;
    await page.route("**/fresh-island::LoginForm*", (route) => {
      if (navs >= 2) return route.continue();
      failed++;
      return route.abort("failed");
    });
    await page.goto("/login");
    // the recovery reloads the page: wait for a navigation of type "reload"
    await page.waitForFunction(
      () =>
        (performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined)?.type === "reload",
      undefined,
      { timeout: 15_000 },
    );
    expect(
      failed >= 1,
      `the island's request(s) failed on the first load (${failed})`,
    );
    const state = await page.evaluate(() => ({
      guard: sessionStorage.getItem("pm:module-reloaded"),
      path: location.pathname,
    }));
    expect(
      Number(state.guard) > Date.now() - 60_000,
      `the cooldown guard was just set (${state.guard})`,
    );
    expect.eq(state.path, "/login", "still the same page");
    // the form is live: typing goes into the island's input and the button is enabled
    const input = page.locator(
      "input[type='tel'], input[inputmode='tel'], input",
    ).first();
    await input.waitFor({ timeout: 10_000 });
    await input.fill("5125550123");
    expect.eq(
      (await input.inputValue()).replace(/\D/g, "").slice(-10),
      "5125550123",
      "the login island took the input",
    );
    // a second failure in the same session never loops: the guard holds, no further reload
    await page.unroute("**/fresh-island::LoginForm*");
    await page.route(
      "**/fresh-island::LoginForm*",
      (route) => route.abort("failed"),
    );
    await page.goto("/login");
    await new Promise((r) => setTimeout(r, 2_500));
    const again = await page.evaluate(() =>
      (performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming).type
    );
    expect.eq(
      again,
      "navigate",
      "the guarded page did not reload a second time",
    );
  }));

Deno.test("REQ-189 AMENDMENT: a module whose ETag differs from the tab's last load means stale code ran — the page reloads itself once and remembers the new ETags", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/login");
    await page.waitForFunction(
      () =>
        Object.keys(
          JSON.parse(sessionStorage.getItem("pm:module-etags") || "{}"),
        ).length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const seeded = await page.evaluate(() => {
      const m = JSON.parse(sessionStorage.getItem("pm:module-etags") || "{}");
      const url = Object.keys(m).find((u) => u.includes("fresh:client-entry"))!;
      m[url] = 'W/"stale"';
      sessionStorage.setItem("pm:module-etags", JSON.stringify(m));
      sessionStorage.removeItem("pm:module-reloaded");
      return url;
    });
    expect(
      seeded.includes("fresh:client-entry"),
      "the client entry's ETag was seeded stale",
    );
    // a plain in-page navigation (not the runner's goto: its screenshot would race the self-reload)
    await page.evaluate('location.assign("/login")');
    const deadline = Date.now() + 15_000;
    let reloaded = false;
    while (!reloaded && Date.now() < deadline) {
      try {
        reloaded = await page.evaluate(() =>
          (performance.getEntriesByType(
            "navigation",
          )[0] as PerformanceNavigationTiming).type === "reload"
        );
      } catch {
        /* execution context torn down by the reload itself — poll again */
      }
      if (!reloaded) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    expect(reloaded, "the page reloaded itself after the ETag mismatch");
    await page.waitForFunction(
      () =>
        Object.keys(
          JSON.parse(sessionStorage.getItem("pm:module-etags") || "{}"),
        ).length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const after = await page.evaluate(() => {
      const m = JSON.parse(sessionStorage.getItem("pm:module-etags") || "{}");
      const url = Object.keys(m).find((u) => u.includes("fresh:client-entry"))!;
      return {
        etag: m[url],
        guard: sessionStorage.getItem("pm:module-reloaded"),
      };
    });
    expect(
      after.etag !== 'W/"stale"' && after.etag.length > 0,
      `the real ETag is remembered (${after.etag})`,
    );
    expect(
      Number(after.guard) > Date.now() - 60_000,
      "the cooldown guard was set by the reload",
    );
    // and it stays put: no second reload with everything matching
    await new Promise((r) => setTimeout(r, 2_000));
    const nav = await page.evaluate(() =>
      performance.getEntriesByType("navigation").length
    );
    expect.eq(nav, 1, "one navigation entry: the page did not reload again");
  }));
