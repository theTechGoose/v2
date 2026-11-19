/**
 * REQ-883..889 — the HR module in the browser, end to end: the owner writes a document in the
 * builder, attaches a system, configures a department (packet + accounts), adds a new hire (the
 * packet preview follows the department) and lands on the hire's file with the signing link; the
 * hire, on their phone (no session), opens /sign/:token, acknowledges one document, signs the
 * other (printed name + a drawn signature) and sees MONSTERIZED; back in the office the packet is
 * Done ×2 with the proof (printed name, audit line), the manual account is marked done and the
 * hire is Active; the overview counts it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "HR Story",
      email: "hr-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Monster Reservations Group" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth, phone, session: { name, value } };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`clickUntil: ${selector} never had its effect`);
}

Deno.test("REQ-883..889: document → system → department → new hire → the phone signs → the office sees the proof and marks the account done", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);

    // 1. a document, written in the builder (REQ-886)
    await page.goto("/hr/documents");
    await clickUntil(
      page,
      "[data-cy='hr-doc-new']",
      async () => await page.locator("[data-cy='hr-doc-name']").isVisible(),
    );
    await page.locator("[data-cy='hr-doc-name']").fill("Employee Handbook");
    await page.locator("[data-cy='hr-doc-label']").fill(
      "the Employee Handbook",
    );
    await page.locator("[data-cy='hr-doc-kind']").selectOption("ack");
    await page.locator("[data-cy='hr-doc-page']").click();
    await page.keyboard.type("Welcome to Monster. Be kind, be on time.");
    // the toast lives 2.4 s — too short to wait on after the harness's screenshot; the
    // version chip is the durable proof that Save bumped it (REQ-886)
    const saved = page.waitForResponse((r) =>
      r.request().method() === "PUT" && r.url().includes("/api/hr/documents/")
    );
    await page.locator("[data-cy='hr-doc-save']").click();
    expect.eq((await saved).status(), 200, "the document saved");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='hr-doc-version']")?.textContent
          ?.trim() === "v2",
      undefined,
      { timeout: 15_000 },
    );
    await page.locator("[data-cy='hr-doc-back']").click();
    await page.locator("[data-cy='hr-doc-card']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Employee Handbook");
    // the second one — to sign — over the API, the same shape the builder saves
    const offer = await (await http("/api/hr/documents", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({
        name: "Offer Letter",
        label: "the Offer Letter",
        kind: "sign",
        creds: true,
        contentHtml: "<h1>Offer</h1><p>Inbound Sales, $18/h.</p>",
      }),
    })).json();

    // 2. the systems (REQ-888) live under Account → Systems now (REQ-912); the old URL lands there
    await page.goto("/hr/systems");
    await page.locator("[data-cy='settings-tab-systems'][aria-selected='true']")
      .waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='sys-email']").waitFor({ timeout: 15_000 });
    await expect.see("E-signatures");
    // REQ-913: a built-in arm — the hire becomes a Worker in DocuMonster
    await page.locator("[data-cy='hr-catalog-card'][data-key='dm-worker']")
      .waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      "[data-cy='hr-catalog-card'][data-key='dm-worker'] [data-cy='hr-attach']",
      async () =>
        await page.locator("[data-cy='hr-sys-card'][data-key='dm-worker']")
          .isVisible(),
    );
    await expect.see("DocuMonster worker account");
    // and a custom system with no webhook: a manual step on the hire (REQ-888b)
    await page.locator("[data-cy='hr-custom-name']").fill("Badge printer");
    await clickUntil(
      page,
      "[data-cy='hr-custom-add']",
      async () =>
        await page.locator("[data-cy='hr-sys-card'][data-key='custom']")
          .isVisible(),
    );
    await expect.see("Badge printer");

    // 3. a department: both documents, the system (REQ-887)
    await page.goto("/hr/departments");
    await clickUntil(
      page,
      "[data-cy='hr-dept-add']",
      async () => await page.locator("[data-cy='hr-dept-modal']").isVisible(),
    );
    await page.locator("[data-cy='hr-dept-new-name']").fill("Inbound Sales");
    await page.locator("[data-cy='hr-dept-create']").click();
    await page.locator("[data-cy='hr-dept-cfg-name']").waitFor({
      timeout: 15_000,
    });
    const docBoxes = page.locator("[data-cy='hr-dept-doc']");
    expect.eq(await docBoxes.count(), 2, "both documents are offered");
    // the handbook first, then the offer — the packet's order
    await page.locator(
      "[data-cy='hr-dept-doc']:not([data-doc='" + offer.id + "'])",
    ).check();
    await page.locator(`[data-cy='hr-dept-doc'][data-doc='${offer.id}']`)
      .check();
    await page.locator("[data-cy='hr-dept-system']").first().check();
    await page.locator("[data-cy='hr-dept-system']").nth(1).check(); // REQ-913: both arms
    const deptSaved = page.waitForResponse((r) =>
      r.request().method() === "PUT" && r.url().includes("/api/hr/departments/")
    );
    await page.locator("[data-cy='hr-dept-save']").click();
    expect.eq((await deptSaved).status(), 200, "the department saved");
    await page.locator("[data-cy='hr-dept-back']").click();
    await page.locator("[data-cy='hr-dept-row']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("2 docs");
    await expect.see("2 systems");

    // 4. the new hire (REQ-884) — the packet preview follows the department
    await page.goto("/hr/hires/new");
    await page.locator("[data-cy='hr-dept'] option").nth(1).waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await page.locator("[data-cy='hr-first']").fill("Dani");
    await page.locator("[data-cy='hr-last']").fill("Reyes");
    await page.locator("[data-cy='hr-phone']").fill(
      `702555${String(1000 + Math.floor(Math.random() * 900))}`,
    );
    await page.locator("[data-cy='hr-email']").fill("dani@example.com");
    await page.locator("[data-cy='hr-dept']").selectOption({
      label: "Inbound Sales",
    });
    await page.locator("[data-cy='hr-packet-doc']").nth(1).waitFor({
      timeout: 15_000,
    });
    await expect.see("Employee Handbook");
    await expect.see("Offer Letter");
    await page.locator("[data-cy='hr-create']").click();
    await page.locator("[data-cy='hr-detail-name']").waitFor({
      timeout: 20_000,
    });
    await expect.see("Dani Reyes");
    await expect.see("Invited");
    const hireUrl = page.url();
    const signUrl =
      (await page.locator("[data-cy='hr-sign-url']").textContent())
        ?.trim() ?? "";
    const token = signUrl.split("/sign/")[1];
    if (!token) throw new Error(`no token in the signing link: ${signUrl}`);
    expect.eq(
      await page.locator("[data-cy='hr-packet-row']").count(),
      2,
      "the frozen packet has both documents",
    );
    await expect.see("Waiting on signatures");

    // 5. the phone (REQ-885): no session, the token is the identity
    await page.context().clearCookies();
    await page.goto(`/sign/${token}?lang=en`);
    await page.locator("[data-cy='hrs-start']").waitFor({ timeout: 15_000 });
    await expect.see("Hi Dani!");
    await expect.see("Monster Reservations Group");
    await clickUntil(
      page,
      "[data-cy='hrs-start']",
      async () => await page.locator("[data-cy='hrs-ack']").isVisible(),
    );
    await expect.see("Step 1 of 2");
    await expect.see("Employee Handbook");
    await expect.see("Be kind, be on time.");
    // Continue without the box: refused on the phone
    await page.locator("[data-cy='hrs-next']").click();
    await page.locator("[data-cy='hrs-err']").waitFor({ timeout: 5_000 });
    await page.locator("[data-cy='hrs-ack']").check();
    await expect.see("I have read and understand the Employee Handbook.");
    await page.locator("[data-cy='hrs-next']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='hrs-step']")?.textContent?.includes(
          "Step 2 of 2",
        ),
      undefined,
      { timeout: 15_000 },
    );
    await expect.see("Offer Letter");
    await expect.see("Sign & finish");
    await page.locator("[data-cy='hrs-ack']").check();
    await page.locator("[data-cy='hrs-printed']").fill("Dani Reyes");
    const pad = page.locator("[data-cy='sign-pad']");
    const box = await pad.boundingBox();
    if (!box) throw new Error("no signature pad");
    await page.mouse.move(box.x + 20, box.y + 60);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(
        box.x + 20 + i * 18,
        box.y + 60 + Math.sin(i) * 25,
      );
    }
    await page.mouse.up();
    await page.locator("[data-cy='hrs-next']").click();
    await page.locator("[data-cy='hrs-done']").waitFor({ timeout: 15_000 });
    await expect.see("You're officially MONSTERIZED!");

    // 6. the office (REQ-885d, REQ-888): the proof, the manual account, Active
    await page.context().addCookies([{ ...owner.session, url: baseUrl }]);
    await page.goto(hireUrl);
    await page.locator("[data-cy='hr-detail-name']").waitFor({
      timeout: 15_000,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='hr-doc-state']").length === 2 &&
        [...document.querySelectorAll("[data-cy='hr-doc-state']")].every((e) =>
          e.textContent?.includes("Done")
        ),
      undefined,
      { timeout: 15_000 },
    );
    await expect.see("Provisioning");
    await page.locator("[data-cy='hr-arm'][data-state='manual']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='hr-view-proof']").nth(1).click();
    await page.locator("[data-cy='hr-proof-modal']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Signature proof");
    expect.eq(
      (await page.locator("[data-cy='hr-proof-name']").textContent())?.trim(),
      "Dani Reyes",
      "the printed name on the proof",
    );
    expect.eq(
      await page.locator("[data-cy='hr-proof-sig']").evaluate((el) =>
        el.tagName
      ),
      "IMG",
      "the drawn signature is on the proof",
    );
    await expect.see("Signed on mobile");
    await page.keyboard.press("Escape");
    await page.locator("[data-cy='hr-proof-modal']").waitFor({
      state: "hidden",
      timeout: 5_000,
    });
    await page.locator("[data-cy='hr-mark-done']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='hr-status']")?.textContent?.trim() ===
          "Active",
      undefined,
      { timeout: 15_000 },
    );
    await expect.see("Created (manual)");
    // REQ-913: the built-in arm made Dani a Worker in DocuMonster
    await page.goto("/field/workers");
    await page.waitForFunction(
      () => document.body.textContent?.includes("Dani Reyes"),
      undefined,
      { timeout: 15_000 },
    );

    // 7. the roster and the overview count it (REQ-884c, REQ-889d)
    await page.goto("/hr/hires");
    await page.locator("[data-cy='hr-hire-row']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Dani Reyes");
    await expect.see("2 of 2");
    await page.goto("/hr");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='hr-stat-completed'] .hr-stat__value")
          ?.textContent === "1",
      undefined,
      { timeout: 15_000 },
    );
    await expect.see("Dani Reyes");
  }));

Deno.test("REQ-1034 (q2-18): Settings › Sistemas in Spanish — the HR catalog card and the attached built-in read in Spanish, not English", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    await (await http("/api/me", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    await page.goto("/settings?tab=systems&lang=es");
    const card = "[data-cy='hr-catalog-card'][data-key='dm-worker']";
    await page.locator(card).waitFor({ timeout: 15_000 });
    // the chrome is Spanish (the kind line goes through t()) …
    await page.waitForFunction(
      () => document.body.textContent?.includes("Agregar"),
      undefined,
      { timeout: 15_000 },
    );
    // … and so must the catalog card's own name and description be
    const [catName, catDesc] = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return [
        el?.querySelector(".hr-sys__name")?.textContent?.trim() ?? "",
        el?.querySelector(".hr-sys__desc")?.textContent?.trim() ?? "",
      ];
    }, card);
    expect(
      !/worker account/i.test(catName),
      `the catalog card name is Spanish (got "${catName}")`,
    );
    expect(
      !/becomes a Worker|texted their PIN/i.test(catDesc),
      `the catalog card description is Spanish (got "${catDesc}")`,
    );
    const catTexts = await page.locator(
      "[data-cy='hr-catalog-card'] .hr-sys__name",
    ).allTextContents();
    expect(
      !catTexts.some((s) =>
        /DocuMonster editor|Welcome email|Welcome text/i.test(s)
      ),
      `no catalog card name is English (got ${JSON.stringify(catTexts)})`,
    );

    // attach it: the stored copy must render in Spanish too
    await clickUntil(
      page,
      `${card} [data-cy='hr-attach']`,
      async () =>
        await page.locator("[data-cy='hr-sys-card'][data-key='dm-worker']")
          .isVisible(),
    );
    const attached = await page.locator(
      "[data-cy='hr-sys-card'][data-key='dm-worker'] [data-cy='hr-sys-name']",
    ).textContent() ?? "";
    expect(
      !/worker account/i.test(attached),
      `the attached built-in's name is Spanish (got "${attached.trim()}")`,
    );
  }));
