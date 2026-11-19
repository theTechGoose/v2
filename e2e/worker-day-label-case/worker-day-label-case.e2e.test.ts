/**
 * REQ-1065 — LOOP-007 cycle 2, QA issue q2-54 [polish/BUG_POLISH]: "Spanish worker dates use mixed
 * capitalisation on one screen". A Spanish worker signs in on /worker: the header reads
 * "Jue 19 de nov", while the selected day tab and the "Viendo …" label read "jue 19 de nov".
 * All three name the same day, so they must carry the same text, starting with a capital.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-1065 (LOOP-007 q2-54): a Spanish worker's header, selected day tab and 'Viendo' label write the day with the same capitalisation", (t) =>
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
    expect(!!cookie, "the owner has a session");
    const auth = { ...JSON_HEADERS, cookie };
    const me = await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es", name: "Casing Story" }),
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

    await page.goto("/worker?lang=es");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='w-day-label'] b").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='w-day-today'] small").waitFor({
      timeout: 15_000,
    });

    // one read, so a re-render cannot land between the three
    const got = await page.evaluate(() => {
      const txt = (sel: string) =>
        (document.querySelector(sel)?.textContent ?? "").trim();
      return {
        header: txt(".greet small"),
        tab: txt("[data-cy='w-day-today'] small"),
        label: txt("[data-cy='w-day-label'] b"),
        selected: document.querySelector("[data-cy='w-day-today']")
          ?.getAttribute("aria-selected") ?? "",
      };
    });
    expect.eq(got.selected, "true", "today is the selected day");
    const cap = /^[A-ZÁÉÍÓÚÑ]/;
    expect(cap.test(got.header), `the header day starts with a capital (got "${got.header}")`);
    expect(cap.test(got.tab), `the selected day tab starts with a capital (got "${got.tab}")`);
    expect(cap.test(got.label), `the 'Viendo' day starts with a capital (got "${got.label}")`);
    expect.eq(got.tab, got.header, "the day tab reads like the header");
    expect.eq(got.label, got.header, "the 'Viendo' label reads like the header");
  }));
