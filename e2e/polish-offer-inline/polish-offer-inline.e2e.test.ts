/**
 * REQ-384 — demo-loop cycle 2, issue m16: "'Professionalize' popup hides the
 * line it rewrites and does little".
 *
 * The demo customer edited a bullet in the Job Details picker and a dimmed
 * full-viewport modal ("Want me to professionalize that?") covered the very
 * line it was about; Yes on an already-clean line changed nothing. In the
 * browser now: after an edit the offer appears INLINE in the same card, right
 * under the edited line (which stays visible and on top), quoting the line
 * and the rewrite; Yes applies the rewrite. An already-clean added line gets
 * no offer at all.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** REQ-332's "A + B" line: the polish always splits it in two. */
const ROUGH = "4 recesed lights + City of Austin permit";

const TYPED =
  "Full gut of the hall bathroom. Demo to studs, cut the slab for a curbless shower, " +
  "frameless glass, 72 inch double vanity, permit included.";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })
    .then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Bath Pro",
    businessName: "Bath Pro LLC",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
}

Deno.test("REQ-384 m16: the polish offer sits inline under the edited line with a before/after, and a clean line gets none", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    const chip = "button.chat__empty-prompt:has-text('help me price it')";
    await clickUntil(
      page,
      chip,
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await page.locator("textarea.composer__input").fill(TYPED);
    await page.locator("button.composer__send").click();
    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const first = page.locator(".chat__jobopts .chat__jobopt").first();
    const bullet = first.locator(".chat__jobopt-bullet").first();

    // edit the first line to rough text
    await bullet.locator(".chat__jobopt-pencil").click();
    const input = first.locator("input.chat__jobopt-edit");
    await input.waitFor({ state: "visible" });
    await input.fill(ROUGH);
    await input.press("Enter");

    // whichever the page shows — the old covering modal or the inline row
    await page.locator(".chat__pro-pop, [data-cy=polish-offer]").first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const offer = page.locator("[data-cy=polish-offer]");
    expect.eq(
      await page.locator(".chat__pro-pop").count(),
      0,
      "no full-viewport professionalize modal",
    );
    expect.eq(
      await first.locator(".chat__jobopt-bullets [data-cy=polish-offer]")
        .count(),
      1,
      "the offer is inside the edited card's own list",
    );
    expect.eq(
      await offer.evaluate((el) =>
        (el.previousElementSibling?.querySelector(".chat__jobopt-text")
          ?.textContent ?? "").trim()
      ),
      ROUGH,
      "the offer sits right under the line it rewrites",
    );
    expect(
      await bullet.evaluate((li) => {
        const r = li.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return !!hit && li.contains(hit);
      }),
      "the edited line stays visible — nothing covers it",
    );
    expect.eq(
      (await offer.locator("[data-cy=polish-offer-before]").innerText()).trim(),
      ROUGH,
      "the offer quotes the line",
    );
    const after = (await offer.locator("[data-cy=polish-offer-after]")
      .innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
    expect.eq(
      after.length,
      2,
      `the preview shows the rewrite — "A + B" becomes two lines (got ${
        JSON.stringify(after)
      })`,
    );

    await offer.locator("button.chat__pro-row-yes").click();
    await offer.waitFor({ state: "detached", timeout: 5_000 });
    const texts = (await first.locator(".chat__jobopt-text").allInnerTexts())
      .map((s) => s.trim());
    expect.eq(
      JSON.stringify(texts.slice(0, 2)),
      JSON.stringify(after),
      "Yes applies exactly the previewed rewrite, in place",
    );

    // an already-clean added line gets no offer
    const clean = "Install frameless glass shower door";
    const addInput = first.locator("input.chat__jobopt-add-input");
    const checked = page.waitForResponse((r) =>
      r.url().includes("/agents/job-details/professionalize") &&
      r.request().method() === "POST"
    );
    await addInput.fill(clean);
    await addInput.press("Enter");
    await checked;
    await page.waitForTimeout(500);
    const stray = await page.locator("[data-cy=polish-offer]").allInnerTexts();
    expect.eq(
      stray.length,
      0,
      `a line that comes back unchanged is not offered (${
        JSON.stringify(stray)
      })`,
    );
    expect(
      (await first.locator(".chat__jobopt-text").allInnerTexts())
        .map((s) => s.trim()).includes(clean),
      "the clean line was added as typed",
    );
  }));
