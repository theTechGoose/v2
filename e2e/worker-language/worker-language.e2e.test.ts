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

/**
 * REQ-494 — demo-loop cycle 3, issue M43 ("Worker view forgets English"): an
 * English owner signs a Spanish worker in, taps EN, leaves, and re-opens
 * /worker the way the sidebar does (no ?lang=). The pick is remembered: the
 * screen stays English through the signed-in load and the 5 s refresh.
 */
Deno.test("REQ-494: EN picked on /worker survives re-opening /worker without ?lang= while the Spanish worker is signed in", (t) =>
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
      body: JSON.stringify({ language: "en", name: "Lang Pick Story" }),
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
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });

    // the person picks English
    await page.locator(".lang button", { hasText: "EN" }).click();
    await page.getByText("Hey, Luis").waitFor({ timeout: 5_000 });

    // away and back the way the sidebar links it: /worker, no ?lang=
    await page.goto("/");
    await page.goto("/worker");
    await page.getByText("Hey, Luis").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(6_000); // the signed-in load + one 5 s refresh
    await expect.see("Hey, Luis");
    await expect.see("My tasks");
    expect(
      await page.evaluate(() => document.documentElement.lang) === "en",
      "<html lang> is en",
    );
  }));

/**
 * REQ-714 — demo-loop cycle 5, issue m58 ("worker view flashes English
 * first"): a Spanish worker already signed in (pm_worker) re-opens /worker on
 * an English browser (pm_lang=en). The server-rendered page is already Spanish
 * — <html lang="es">, the Spanish title — so nothing paints English and flips;
 * the browser's pm_lang stays en (REQ-416).
 */
Deno.test("REQ-714 m58: a signed-in Spanish worker on an English browser gets a Spanish page from the server — no English first paint", (t) =>
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
      body: JSON.stringify({ language: "en", name: "SSR Lang Story" }),
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

    // the worker signs in (as the island does) — the pm_worker session
    const li = await http("/api/field/worker/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: cell, pin: "1234" }),
    });
    await li.body?.cancel();
    const token = (li.headers.get("set-cookie") ?? "").split(";")[0]
      .split("=").slice(1).join("=");
    expect(!!token, `the worker has a session (${li.status})`);

    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name: "pm_lang", value: "en", domain, path: "/" },
        { name: "pm_worker", value: token, domain, path: "/" },
      ]),
    );

    const res = await page.goto("/worker");
    const html = (await res?.text()) ?? "";
    expect(
      /<html[^>]*\blang="es"/.test(html),
      `the server-rendered <html lang> is es (${
        html.match(/<html[^>]*>/)?.[0]
      })`,
    );
    expect(
      html.includes("Mis tareas · DocuMonster"),
      "the server-rendered title is Spanish",
    );
    await page.getByText("Hola, Luis").waitFor({ timeout: 15_000 });
    const stored = (await page.context().cookies()).find((c) =>
      c.name === "pm_lang"
    )?.value;
    expect(stored === "en", `pm_lang is still en (got ${stored})`);
  }));
