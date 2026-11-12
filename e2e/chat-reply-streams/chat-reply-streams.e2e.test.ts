/**
 * REQ-670 (demo-loop cycle 5, p7 "Assistant replies never stream and show no
 * typing in the text" — pairs 3 and 7, both sides of the demo; the backlog's
 * c1-nc-6, c2-nc-stream, c4-nc-no-streaming) on the real app.
 *
 * The chat awaited the whole JSON turn: three dots with no words, then the
 * whole reply at once. Now the composer's turn goes to POST
 * /api/agents/chat/stream: the pending bubble says in words what the turn is
 * doing ("Assistant is thinking…") and then grows with the reply as it is
 * written, and the finished reply takes its place. The bubble is DOM like any
 * other, so the demo stage mirrors it.
 *
 * A MutationObserver in the page records every state of the pending bubble;
 * the reply must have been seen growing (several prefixes of it) before it
 * landed. Works on the stub LLM (it streams its echo word by word) and on the
 * real model.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the stream from
 * backend/src/agents/entrypoints/chat-controller, read by
 * front-end/lib/chat-stream.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const QUESTION =
  "how do I keep a client happy when a job runs a couple of days past the date we agreed on? give me a few short ideas";

/** Signed in, past onboarding (Austin, TX), in English. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<void> {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** Type a line and send it once the island is live: a keypress before
 *  hydration is lost, so retry only while the line has not shown up as the
 *  contractor's own bubble (one that did post is never sent twice). */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

interface Seen {
  labels: string[];
  texts: string[];
}

Deno.test("REQ-670 p7: the assistant's reply streams into its bubble as it is written, and the waiting bubble says in words that it is thinking", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    // every state of the pending bubble, recorded in the page as it happens
    await page.evaluate(() => {
      const seen = { labels: [] as string[], texts: [] as string[] };
      (globalThis as unknown as { __pending: Seen }).__pending = seen;
      const look = () => {
        const label = document.querySelector("[data-cy=msg-typing-label]")
          ?.textContent?.trim() ?? "";
        const text = document.querySelector("[data-cy=msg-streaming]")
          ?.textContent ?? "";
        if (label && seen.labels[seen.labels.length - 1] !== label) {
          seen.labels.push(label);
        }
        if (text && seen.texts[seen.texts.length - 1] !== text) {
          seen.texts.push(text);
        }
      };
      new MutationObserver(look).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    const repliesBefore = await page.locator(".msg:not(.msg--user)").count();
    await say(page, QUESTION);
    // the turn is over: no pending bubble, and a new reply under the question
    await page.waitForFunction(
      (before) =>
        !document.querySelector(
          "[data-cy=msg-streaming], [data-cy=msg-typing-label]",
        ) &&
        document.querySelectorAll(".msg:not(.msg--user)").length >
          (before as number),
      repliesBefore,
      { timeout: 45_000 },
    );
    const reply = (await page.locator(".msg:not(.msg--user) .msg__bubble")
      .last().innerText()).trim();
    await page.locator(".msg:not(.msg--user) .msg__bubble").last().hover();
    const seen = await page.evaluate(() =>
      (globalThis as unknown as { __pending: Seen }).__pending
    );

    expect(
      seen.labels.includes("Assistant is thinking…"),
      `the waiting bubble said it in words (saw labels: ${
        JSON.stringify(seen.labels)
      })`,
    );
    expect(
      seen.texts.length >= 2,
      `the reply was seen growing in its bubble before it landed (saw ${seen.texts.length} states: ${
        JSON.stringify(seen.texts.slice(0, 4))
      })`,
    );
    expect(
      seen.texts.every((s, i) =>
        i === 0 || s.startsWith(seen.texts[i - 1].trimEnd())
      ),
      `each state of the bubble grew from the one before (${
        JSON.stringify(seen.texts.slice(0, 6))
      })`,
    );
    const last = (seen.texts[seen.texts.length - 1] ?? "").trim();
    expect(
      last.length > 0 && reply.startsWith(last),
      `the streamed text is the reply that landed (streamed: ${
        last.slice(0, 80)
      } / reply: ${reply.slice(0, 80)})`,
    );
  }));
