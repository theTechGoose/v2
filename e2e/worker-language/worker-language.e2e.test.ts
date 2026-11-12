/**
 * REQ-285 — the /worker screen opens in the worker's language (demo issue
 * customers-payments-fieldops-m3): an English owner adds a Spanish worker and
 * signs them in from the owner's own browser (its pm_lang cookie says en, as
 * in the demo); once signed in the screen is Spanish. The EN switch is the
 * person's choice and survives the 5 s refresh.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-285: an English owner's browser opens /worker, a Spanish worker signs in, the screen turns Spanish; EN sticks once picked", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the owner, English
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
      body: JSON.stringify({ language: "en", name: "Lang Story" }),
    });
    await me.body?.cancel();

    // a Spanish worker
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
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();

    // the owner's browser: its language cookie is English
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "en",
        domain,
        path: "/",
      })),
    );
    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await expect.see("Sign in"); // the login screen follows the browser, as before
    await page.locator("[data-cy='w-login']").click();

    // signed in: the worker's own language
    await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });
    await expect.see("Mis tareas");

    // the EN switch is the person's choice — it stays through the 5 s refresh
    await page.locator(".lang button", { hasText: "EN" }).click();
    await page.getByText("Hey, Luis").waitFor({ timeout: 5_000 });
    await page.waitForTimeout(6_000);
    await expect.see("Hey, Luis");
    await expect.see("My tasks");
  }));

/**
 * REQ-416 — demo-loop cycle 2, issue p13-n ("Worker sign-in stays Spanish
 * after 'Salir'"): the worker's language lasts the signed-in session only. An
 * English browser signs a Spanish worker in, the screen turns Spanish, Salir →
 * the sign-in form is English again and the browser's pm_lang is still en.
 */
Deno.test("REQ-416: an English browser, a Spanish worker signs in, Salir → the sign-in form is English and pm_lang stays en", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
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
      body: JSON.stringify({ language: "en", name: "Lang Session Story" }),
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
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();

    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "en",
        domain,
        path: "/",
      })),
    );
    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await expect.see("Sign in");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });

    // Salir: back to the sign-in form, in the browser's own language
    await page.locator("[data-cy='w-logout']").click();
    await page.locator("[data-cy='w-login']").waitFor({ timeout: 15_000 });
    const label = (await page.locator("[data-cy='w-login']").textContent())
      ?.trim();
    expect(label === "Sign in", `the sign-in button reads "${label}"`);
    expect(
      await page.evaluate(() => document.documentElement.lang) === "en",
      "<html lang> is en again",
    );
    const stored = (await page.context().cookies()).find((c) =>
      c.name === "pm_lang"
    )?.value;
    expect(stored === "en", `pm_lang is still en (got ${stored})`);
    const ls = await page.evaluate(() => localStorage.getItem("pm:lang"));
    expect(ls !== "es", `pm:lang was not overwritten (got ${ls})`);
  }));
