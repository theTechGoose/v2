/**
 * REQ-634 — demo-loop cycle 5, issue m34 (run r37f88707, fleet-1
 * stdout:410-415): "Toqué 'agregar correo' → se vuelve una cajita vacía MUY
 * pequeña (25px), sin texto guía … apreté Enter: NO se guardó, metió un salto
 * de línea … el correo aparece DOS veces", and the employee's stage drew
 * "maria@example.com ENCIMA del texto 'agregar correo'".
 *
 * In a browser, on the quote review of a customer with a phone and no email:
 * focusing the email keeps a usable width and its hint; Enter saves (one PUT,
 * focus leaves, no line break); the card then shows the email exactly once;
 * Escape reverts an edit. A never-focused copy of the field (what the demo
 * stage mirrors) shows no placeholder once it holds text.
 *
 * Page: /assistant/[id] (island AsstChat.tsx; key rule front-end/lib/hero-field-edit.ts).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Email User", language: "en" }],
      ["/api/profile/identity", { businessName: "Email Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** Answer every wizard step in the browser until the quote review opens:
 *  a new customer with a phone and no email, then the first plain option
 *  of each remaining step. */
async function finishWizardToReview(page: StoryTools["page"]) {
  const review = page.locator(".quote-review");
  const startQuestion = page.getByText(/when does the job start/i);
  await page.locator(".wiz__opts, .cust-create").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  if ((await startQuestion.count()) === 0) {
    if ((await page.locator(".cust-create").count()) === 0) {
      await page.locator(".wiz-opt--custom:visible").first().click();
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Email Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550944");
    await page.locator(".cust-create__btn--primary").click();
  }
  const plain = page.locator(
    ".wiz__opts .wiz-opt:not(.wiz-opt--custom):visible",
  );
  for (let i = 0; i < 10; i++) {
    await page.locator(".quote-review, .wiz__opts .wiz-opt:visible").first()
      .waitFor({ state: "visible", timeout: 20_000 });
    if (await review.first().isVisible().catch(() => false)) return;
    const label = (await plain.first().innerText()).trim();
    await plain.first().click();
    await page.waitForFunction(
      (l) =>
        ![...document.querySelectorAll(".wiz__opts .wiz-opt")].some((e) =>
          (e as HTMLElement).offsetParent !== null &&
          (e as HTMLElement).innerText.trim() === l
        ),
      label,
      { timeout: 20_000 },
    ).catch(() => {});
  }
  await review.first().waitFor({ state: "visible", timeout: 20_000 });
}

Deno.test("REQ-634 m34: the review card's 'add email' is a real field — usable width with its hint, Enter saves once, the email shows once, Escape reverts, and an unfocused copy never draws the hint over the text", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const quote = await post(http, auth, "/api/quotes", {
      summary: "Lawn mowing",
      jobName: "Lawn mowing",
      lineItems: [{
        description: "Lawn mowing",
        quantity: 1,
        unit: "ea",
        price: 18000,
      }],
      estimatedTotal: 18000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );

    const puts: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "PUT" && /\/api\/(customers|clients)\//.test(r.url())
      ) {
        puts.push(r.postData() ?? "");
      }
    });

    await page.goto(`/assistant/${conv.id}`);
    await finishWizardToReview(page);

    // before REQ-634 the email was the first contentEditable span of the meta row
    const field = page.locator(
      "[data-cy='quote-review-email'], .quote-review__hero-meta > span.quote-review__hero-field",
    ).first();
    await field.waitFor({ state: "visible", timeout: 20_000 });
    await field.click();
    const focused = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const shown = el instanceof HTMLInputElement
        ? (el.value === "" ? el.placeholder : el.value)
        : getComputedStyle(el, "::before").content;
      return { width: r.width, shown };
    });
    expect(
      focused.width >= 80,
      `focused, the empty email field is wide enough to type in (was ${focused.width}px)`,
    );
    expect(
      /add email/i.test(focused.shown),
      `focused, the empty field still shows its hint (got ${
        JSON.stringify(focused.shown)
      })`,
    );

    await page.keyboard.type("maria@example.com");
    // the demo stage mirrors this element into a frame where it is never focused
    const stageCopy = await field.evaluate((el) => {
      const host = el.closest(".quote-review__hero-meta") ?? el.parentElement!;
      const copy = host.cloneNode(true) as HTMLElement;
      copy.setAttribute("data-cy", "stage-copy");
      document.body.appendChild(copy);
      const hints: string[] = [];
      for (const n of [copy, ...copy.querySelectorAll("*")]) {
        const before = getComputedStyle(n, "::before").content;
        if (/add email/i.test(before)) hints.push(before);
        if (n instanceof HTMLInputElement && n.matches(":placeholder-shown")) {
          if (/add email/i.test(n.placeholder)) hints.push(n.placeholder);
        }
      }
      const text = copy.innerText + " " +
        [...copy.querySelectorAll("input")].map((i) => i.value).join(" ");
      copy.remove();
      return { hints, text };
    });
    expect(
      stageCopy.text.includes("maria@example.com"),
      `the unfocused copy carries the typed email (got ${
        JSON.stringify(stageCopy.text)
      })`,
    );
    expect.eq(
      stageCopy.hints.length,
      0,
      "an unfocused copy holding text draws no 'add email' hint over it",
    );

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => !document.activeElement?.matches("[data-cy='quote-review-email']"),
      undefined,
      { timeout: 5_000 },
    ).catch(() => {});
    expect(
      !(await field.evaluate((el) => el === document.activeElement)),
      "Enter leaves the field (it commits instead of inserting a line break)",
    );
    await page.waitForTimeout(800);
    expect.eq(puts.length, 1, "Enter saved the email with one PUT");
    expect(
      (puts[0] ?? "").includes("maria@example.com"),
      `the PUT carries the email (got ${puts[0]})`,
    );

    // the customer's own contact row (the first hero-meta is the sender's)
    const card = await page.locator(
      ".quote-review__hero-meta:has(.quote-review__hero-field)",
    ).last().evaluate((el) => ({
      text: (el as HTMLElement).innerText + " " +
        [...el.querySelectorAll("input")].map((i) => i.value).join(" "),
      html: el.innerHTML,
    }));
    expect.eq(
      card.text.split("maria@example.com").length - 1,
      1,
      `the card shows the email exactly once (got ${
        JSON.stringify(card.text)
      })`,
    );
    expect(
      !/<br|<div/i.test(card.html),
      "no line break was typed into the card",
    );

    // Escape reverts an edit and saves nothing
    await field.click();
    await page.keyboard.press("End");
    await page.keyboard.type("xyz");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect.eq(
      await field.inputValue().catch(() => field.innerText()),
      "maria@example.com",
      "Escape puts the saved email back",
    );
    expect(
      !(await field.evaluate((el) => el === document.activeElement)),
      "Escape leaves the field",
    );
    expect.eq(puts.length, 1, "Escape saves nothing");
  }));
