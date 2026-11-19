/**
 * REQ-1160 — LOOP-007 cycle 3, QA issues q3-92 [minor/BUG_POLISH] "Worker header date follows the
 * viewed day, not today" and q3-100 [polish/BUG_POLISH] "Worker sign-in screen after logout shows the
 * last viewed day, not today".
 *
 * A Spanish worker taps Mañana: the greeting line under "Hola, <name>" must keep today's date (the
 * "Viendo" label is the one that names the viewed day). Then Salir: the sign-in card's date line
 * reads today, the URL carries no ?date=, and the next sign-in lands on Hoy.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-1160 (LOOP-007 q3-92, q3-100): the worker greeting names today while viewing Mañana, and Salir returns the sign-in card to today", (t) =>
  story(t, async ({ page, expect, http }) => {
    const r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    expect(!!cookie, `the owner has a session (verify ${r.status}: ${JSON.stringify(body).slice(0, 200)})`);
    const auth = { ...JSON_HEADERS, cookie };
    const me = await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es", name: "Header Story" }),
    });
    await me.body?.cancel();

    const cell = `843${digits()}`;
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Luis",
        phoneNumber: cell,
        pin: "1234",
        language: "es",
      }),
    });
    expect(w.status === 201 || w.status === 200, `worker created (${w.status})`);
    await w.body?.cancel();

    const signIn = async () => {
      await page.locator("[data-cy='w-cell']").fill(cell);
      await page.locator("[data-cy='w-pin']").fill("1234");
      await page.locator("[data-cy='w-login']").click();
      await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });
      await page.locator("[data-cy='w-day-today'] small").waitFor({
        timeout: 15_000,
      });
    };

    await page.goto("/worker?lang=es");
    await signIn();
    const todayLabel = (
      (await page.locator("[data-cy='w-day-today'] small").textContent()) ?? ""
    ).trim();
    expect(!!todayLabel, "the Hoy tab names today");

    // q3-92 — tap Mañana: the viewed day moves, the greeting line must not
    await page.locator("[data-cy='w-day-next']").click();
    await page.waitForURL(/\/worker\?(.*&)?date=\d{4}-\d{2}-\d{2}/, {
      timeout: 15_000,
    });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-day-next']")?.getAttribute(
          "aria-selected",
        ) === "true",
      undefined,
      { timeout: 15_000 },
    );
    const onTomorrow = await page.evaluate(() => {
      const txt = (sel: string) =>
        (document.querySelector(sel)?.textContent ?? "").trim();
      return {
        header: txt(".greet small"),
        today: txt("[data-cy='w-day-today'] small"),
        label: txt("[data-cy='w-day-label'] b"),
      };
    });
    expect(
      onTomorrow.label !== onTomorrow.today,
      `the 'Viendo' label moved to tomorrow (got "${onTomorrow.label}")`,
    );
    expect.eq(
      onTomorrow.header,
      todayLabel,
      "q3-92: under 'Hola, Luis' the date stays today while viewing Mañana",
    );
    expect(
      onTomorrow.header !== onTomorrow.label,
      `q3-92: the header does not repeat the viewed day "${onTomorrow.label}"`,
    );

    // q3-100 — Salir: the sign-in card names today and the URL forgets the viewed day
    await page.locator("[data-cy='w-logout']").click();
    await page.locator("[data-cy='w-cell']").waitFor({ timeout: 15_000 });
    const signedOut = await page.evaluate(() => ({
      header: (document.querySelector(".greet small")?.textContent ?? "").trim(),
      url: location.href,
    }));
    expect.eq(
      signedOut.header,
      todayLabel,
      "q3-100: the sign-in card ('Mis tareas') shows today after Salir",
    );
    expect(
      !new URL(signedOut.url).searchParams.has("date"),
      `q3-100: Salir drops ?date= from the URL (got ${signedOut.url})`,
    );

    // the next worker starts on Hoy, not on the stale tomorrow
    await signIn();
    await page.waitForTimeout(300);
    const again = await page.evaluate(() => ({
      selected: document.querySelector("[data-cy='w-day-today']")
        ?.getAttribute("aria-selected") ?? "",
      header: (document.querySelector(".greet small")?.textContent ?? "").trim(),
    }));
    expect.eq(again.selected, "true", "q3-100: the next sign-in lands on Hoy");
    expect.eq(again.header, todayLabel, "the greeting names today");
  }));
