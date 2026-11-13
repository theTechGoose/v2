/**
 * REQ-779 — demo-loop cycle dv1, issue m7: "Assistant keeps every job detail
 * the contractor typed (address, email)".
 *
 * In a browser, the verifier's own sentence: "Bathroom floor for the
 * Hendersons on Shoal Creek: porcelain 12x24, recessed niche, before
 * Thanksgiving, email tom@reyes". The customer step opened with the job
 * address empty and the Email box empty, with no word about "tom@reyes". It
 * now has "Shoal Creek" in the job-address box, "tom@reyes" in the Email box
 * with a note that it looks incomplete, and Next waits until it is fixed.
 *
 * Seeded like REQ-575's wizard stories (a quote carrying the typed text, a
 * conversation on it, transition-to-terms) — no LLM turn.
 *
 * Page: /assistant/[id] (CustomerStepPanel in front-end/islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const DEMO =
  "Bathroom floor for the Hendersons on Shoal Creek: porcelain 12x24, recessed niche, before Thanksgiving, email tom@reyes";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** A signed-in, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
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
  await answerQuestions(http, auth, {
    name: "Fact Reader",
    businessName: "Fact Reader Remodeling",
  });
  const res = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await res.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** A quote whose description is the typed job, a conversation on it, and the
 *  terms wizard started — the page opens on the customer step. */
async function seedWizard(
  http: StoryTools["http"],
  auth: Record<string, string>,
  typed: string,
): Promise<string> {
  const post = async (path: string, payload?: unknown) => {
    const res = await http(path, {
      method: "POST",
      headers: auth,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return await res.json().catch(() => ({}));
  };
  const quote = await post("/api/quotes", {
    summary: "Typed job",
    description: typed,
    lineItems: [{
      description: "Typed job",
      quantity: 1,
      unit: "ea",
      price: 3_800_000,
    }],
    estimatedTotal: 3_800_000,
  });
  const conv = await post("/api/agents/conversations", { quoteId: quote.id });
  await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);
  return conv.id;
}

/** Read an input until it holds `want` (the quote loads after the step). */
async function valueOf(
  page: StoryTools["page"],
  input: ReturnType<StoryTools["page"]["locator"]>,
  want: string,
): Promise<string> {
  let got = "";
  for (let i = 0; i < 40 && got !== want; i++) {
    got = await input.inputValue();
    if (got !== want) await page.waitForTimeout(250);
  }
  return got;
}

Deno.test("REQ-779 dv1 m7: 'on Shoal Creek … email tom@reyes' — the step has the job address, and says the email looks incomplete until it is fixed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const convId = await seedWizard(http, auth, DEMO);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);

    const form = page.locator(".cust-create").first();
    await form.waitFor({ state: "visible", timeout: 20_000 });
    const address = form.locator('[data-cy="wizard-service-address"]');
    expect.eq(
      await valueOf(page, address, "Shoal Creek"),
      "Shoal Creek",
      "the job address typed 'on Shoal Creek' is in the address box",
    );
    const email = form.locator("input[type=email]");
    expect.eq(
      await valueOf(page, email, "tom@reyes"),
      "tom@reyes",
      "the typed email is kept in the Email box, not dropped",
    );
    const note = page.locator('[data-cy="cust-email-incomplete"]');
    await note.waitFor({ state: "visible", timeout: 10_000 });
    const said = await note.innerText();
    expect(
      said.includes("tom@reyes") && /incomplete/i.test(said),
      `the note names the typed email and says it looks incomplete: ${said}`,
    );
    const next = form.locator(".cust-create__btn--primary").last();
    expect(await next.isDisabled(), "Next waits for a full email");

    await email.fill("tom@reyes.com");
    await note.waitFor({ state: "hidden", timeout: 10_000 });
    expect(
      !(await next.isDisabled()),
      "a full email lets the contractor go on",
    );
  }));
