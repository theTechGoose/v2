/**
 * REQ-446 — demo-loop cycle 3, issue m13 (fleet-6, Mia 12:08): "Rewrote the
 * versions with your change … My selection got RESET to card 1."
 *
 * On the Job details picker the contractor picks card 2, then tells the
 * assistant a fix ("Tell the assistant…", REQ-392). The assistant answers
 * with rewritten versions; the pick follows the rewrite — here to card 3,
 * the same version (concise / standard / detailed) holding card 2's own
 * lines — instead of jumping back to card 1, and every rewritten card says
 * which version it is.
 *
 * The assistant's answer is the server's real reply with its versions
 * swapped for a known rewrite (the stub LLM cannot rewrite them), so the
 * story pins what the ISLAND does with an answer, not the model's wording.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx applyStepAnswer →
 * shared/quote-flow/option-bullets.ts carryPickedOptionId).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

const TYPED =
  "Kitchen remodel for Mia Lopez.\nDemo the old kitchen\nHaul away debris\nInstall 22 lf of cabinets\n48 sqft quartz countertops";
const FIX = "Add a new drain line through the slab";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<void> {
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
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Mia Lopez",
    businessName: "Lopez Kitchens",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
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
  throw new Error(`${selector}: the click never took`);
}

const selectedIndex = (page: StoryTools["page"]) =>
  page.locator(".chat__jobopt").evaluateAll((els) =>
    els.findIndex((e) => e.classList.contains("is-selected"))
  );

Deno.test("REQ-446 (cycle 3, m13): a refinement on the Job details picker keeps the contractor's pick — never back to card 1 — and each rewritten card names its version", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await clickUntil(
      page,
      "button.chat__empty-prompt:has-text('help me price it')",
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await page.locator("textarea.composer__input").fill(TYPED);
    await page.locator("button.composer__send").click();

    // The confirm picker: pick card 2.
    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const cards = page.locator(".chat__jobopt");
    expect((await cards.count()) >= 2, "the picker offers versions");
    await clickUntil(
      page,
      ".chat__jobopt >> nth=1",
      async () => (await selectedIndex(page)) === 1,
    );
    expect.eq(await selectedIndex(page), 1, "card 2 is picked");
    const picked = (await cards.nth(1).locator(".chat__jobopt-text")
      .allInnerTexts()).map((s) => s.trim()).filter(Boolean);

    // The version card 2 is (a live model labels it; the stub's fallback
    // does not).
    const pickedLabel = (await cards.nth(1).locator("[data-cy=jobopt-style]")
      .allInnerTexts()).map((s) => s.trim().toLowerCase())[0] ?? "";
    const pickedStyle = ["concise", "standard", "detailed"].includes(
        pickedLabel,
      )
      ? pickedLabel
      : "standard";
    const others = ["concise", "standard", "detailed"].filter((s) =>
      s !== pickedStyle
    );

    // The assistant's rewrite: card 3 is card 2's version — its lines plus
    // the fix, and its role when it had one; cards 1 and 2 are the other
    // roles in other words. The pick must follow to card 3.
    const rewrite = [
      {
        id: "opt1",
        style: others[0],
        jobName: "Kitchen Gut",
        summary: "Kitchen gut",
        bullets: ["Kitchen gut and new drain"],
      },
      {
        id: "opt2",
        style: others[1],
        jobName: "Kitchen Overhaul",
        summary: "Kitchen overhaul",
        bullets: ["Gut the room", "Slab drain"],
      },
      {
        id: "opt3",
        style: pickedStyle,
        jobName: "Kitchen Renovation",
        summary: "Kitchen renovation",
        bullets: [...picked, "New drain line through slab"],
      },
    ];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    await page.route("**/agents/chat", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const msgs = (body.newMessages ?? []) as Array<
        { role: string; content: string; payload?: Record<string, unknown> }
      >;
      let answer = [...msgs].reverse().find((m) =>
        m.role === "assistant" && m.payload?.step === "job_details"
      );
      if (!answer) {
        answer = {
          ...(msgs[msgs.length - 1] ?? {}),
          role: "assistant",
          content:
            "Rewrote the versions with your change — pick the one that fits.",
          payload: { step: "job_details" },
        } as typeof msgs[number];
        msgs.push(answer);
      }
      answer.payload = {
        ...answer.payload,
        step: "job_details",
        jobOptions: { options: rewrite, degraded: false },
      };
      body.newMessages = msgs;
      await route.fulfill({ response: res, json: body });
    });

    await clickUntil(
      page,
      ".chat__jobopts [data-cy=step-composer-open]",
      async () =>
        (await page.locator("[data-cy=step-composer-input]").count()) > 0,
    );
    const input = page.locator("[data-cy=step-composer-input]");
    await input.fill(FIX);
    const answered = page.waitForResponse((r) =>
      r.url().includes("/agents/chat") && r.request().method() === "POST"
    );
    await input.press("Enter");
    await answered;

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".chat__jobopt .chat__jobopt-text")]
          .some((e) => (e.textContent ?? "").includes("New drain line")),
      undefined,
      { timeout: 20_000 },
    );
    expect.eq(await cards.count(), 3, "the three rewritten versions show");
    expect.eq(
      await selectedIndex(page),
      2,
      "the pick follows card 2's lines to the rewritten card that holds them — not reset to card 1",
    );
    expect.eq(
      JSON.stringify(
        (await page.locator(".chat__jobopt [data-cy=jobopt-style]")
          .allInnerTexts()).map((s) => s.trim()),
      ),
      JSON.stringify(rewrite.map((o) => cap(o.style))),
      "each rewritten card names its version",
    );
  }));
