/**
 * REQ-442 — demo-loop cycle 3 (run re05e1cbb), issues M22 "User's own chat
 * messages don't appear until reload" and m49 "'Setting up…' card shows the
 * original message, not the correction".
 *
 * Cause (RCA at cc5d4b0e, analyst + skeptic UPHELD):
 *  - M22: while a guided panel is open (panelOpen — the Job details picker,
 *    Pick a price …) the chat scroll area renders the panel INSTEAD of the
 *    thread. A message typed in the step composer (REQ-392) went into
 *    `messages`, which are not mounted; the step showed only the assistant's
 *    note. A reload brought every bubble back.
 *  - m49: step sends went through submitTurn's shared `sending` flag, so the
 *    confirm strip's label and Continue switched to "Setting up…" over the
 *    ORIGINAL message (pendingJobDetailsRaw) while the correction was being
 *    rewritten.
 *
 * Fix: a step exchange log (what the contractor said + the assistant's note)
 * shown on the step; a separate `stepSending` flag for step sends with a
 * "Rewriting with your change…" line carrying the correction; the confirm
 * strip's echo takes the correction once the rewrite lands; the conversation
 * list refreshes after the thread's first turn so its title shows.
 */
import * as fs from "fs";
import * as path from "path";
import {
  addStepExchange,
  echoWithCorrection,
  STEP_LOG_MAX,
} from "../../shared/quote-flow/step-composer";
import {
  isFirstUserTurn,
  publishThreadTurn,
  THREAD_TURN_EVENT,
} from "../../front-end/lib/thread-status-sync";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const RAW =
  "Kitchen remodel for Karen Henderson: new cabinets, quartz counters, tile backsplash";
const FIX = "also add the under-cabinet lighting and haul-away";

describe("REQ-442 M22: the step keeps its own transcript of the composer exchange", () => {
  test("REQ-442: the first exchange on a step starts its log — what was said and the answer", () => {
    const log = addStepExchange(
      null,
      "job_details",
      FIX,
      "Rewrote the versions with your change",
    );
    expect(log).toEqual({
      step: "job_details",
      exchanges: [{
        said: FIX,
        answer: "Rewrote the versions with your change",
      }],
    });
  });

  test("REQ-442: a second exchange on the same step is appended, in order", () => {
    const one = addStepExchange(null, "price", "more like $28k", "Re-priced");
    const two = addStepExchange(one, "price", "make it $27,500", "Set $27,500");
    expect(two.exchanges.map((e) => e.said)).toEqual([
      "more like $28k",
      "make it $27,500",
    ]);
    expect(one.exchanges).toHaveLength(1); // never mutated
  });

  test("REQ-442: a different step starts a fresh log (the last step's words don't follow)", () => {
    const one = addStepExchange(null, "job_details", FIX, "Rewrote");
    const two = addStepExchange(one, "price", "more like $28k", "Re-priced");
    expect(two).toEqual({
      step: "price",
      exchanges: [{ said: "more like $28k", answer: "Re-priced" }],
    });
  });

  test("REQ-442: the strip stays short — only the last STEP_LOG_MAX exchanges", () => {
    let log = null as ReturnType<typeof addStepExchange> | null;
    for (let i = 0; i < STEP_LOG_MAX + 2; i++) {
      log = addStepExchange(log, "price", `try ${i}`, `ok ${i}`);
    }
    expect(log!.exchanges).toHaveLength(STEP_LOG_MAX);
    expect(log!.exchanges[STEP_LOG_MAX - 1].said).toBe(
      `try ${STEP_LOG_MAX + 1}`,
    );
  });

  test("REQ-442: blank words are trimmed; an empty say is not logged", () => {
    const log = addStepExchange(
      null,
      "price",
      "  more like $28k  ",
      "  Re-priced ",
    );
    expect(log.exchanges[0]).toEqual({
      said: "more like $28k",
      answer: "Re-priced",
    });
    expect(addStepExchange(log, "price", "   ", "x")).toBe(log);
  });
});

describe("REQ-442 m49: the confirm strip echoes the correction once the rewrite lands", () => {
  test("REQ-442: the correction follows the message on its own line", () => {
    expect(echoWithCorrection(RAW, FIX)).toBe(`${RAW}\n${FIX}`);
  });

  test("REQ-442: no message yet → the correction alone; a repeat is not added twice", () => {
    expect(echoWithCorrection(null, FIX)).toBe(FIX);
    expect(echoWithCorrection("", ` ${FIX} `)).toBe(FIX);
    const once = echoWithCorrection(RAW, FIX);
    expect(echoWithCorrection(once, FIX)).toBe(once);
  });

  test("REQ-442: a blank correction leaves the message as it was", () => {
    expect(echoWithCorrection(RAW, "  ")).toBe(RAW);
  });
});

describe("REQ-442 M22: the conversation list refreshes after the thread's first turn", () => {
  test("REQ-442: the first turn is the one sent while the thread has no user message", () => {
    expect(isFirstUserTurn([])).toBe(true);
    expect(isFirstUserTurn([{ role: "assistant" }])).toBe(true);
    expect(isFirstUserTurn([{ role: "assistant" }, { role: "user" }])).toBe(
      false,
    );
  });

  test("REQ-442: publishThreadTurn dispatches THREAD_TURN_EVENT with the conversation id", () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    const g = globalThis as unknown as {
      dispatchEvent: (e: Event) => boolean;
      addEventListener: EventTarget["addEventListener"];
      removeEventListener: EventTarget["removeEventListener"];
      CustomEvent?: typeof CustomEvent;
    };
    const saved = {
      dispatchEvent: g.dispatchEvent,
      addEventListener: g.addEventListener,
      removeEventListener: g.removeEventListener,
    };
    g.dispatchEvent = (e) => target.dispatchEvent(e);
    g.addEventListener = target.addEventListener.bind(target);
    g.removeEventListener = target.removeEventListener.bind(target);
    try {
      target.addEventListener(
        THREAD_TURN_EVENT,
        (e) => seen.push((e as CustomEvent).detail),
      );
      publishThreadTurn("c-1");
      expect(seen).toEqual([{ conversationId: "c-1" }]);
    } finally {
      Object.assign(g, saved);
    }
  });
});

describe("REQ-442: copy and wiring", () => {
  test("REQ-442: both languages say 'Rewriting with your change…' and label the contractor's line", () => {
    for (
      const k of [
        "asstChat.stepComposer.rewriting",
        "asstChat.stepComposer.you",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["asstChat.stepComposer.rewriting"]).toBe(
      "Rewriting with your change…",
    );
  });

  test("REQ-442: a step send runs on its own stepSending flag, not the shared `sending`", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /const \[stepSending, setStepSending\] = useState\(false\)/,
    );
    // sendStepText hands submitTurn the step flag
    const fn = src.slice(src.indexOf("async function sendStepText("));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/setStepSending/);
    expect(body).toMatch(/applyStepAnswer\(step, answered, said\)/);
    expect(src).toMatch(/addStepExchange\(log, step, said,/);
    // the confirm strip still labels itself from `sending` only
    expect(src).not.toMatch(
      /stepSending\s*\?\s*tFor\(lang, "asstChat\.settingUp"\)/,
    );
  });

  test("REQ-442: the step composer shows the transcript and the pending correction", () => {
    const comp = read("front-end/components/StepComposer.tsx");
    expect(comp).toMatch(/data-cy="step-composer-said"/);
    expect(comp).toMatch(/data-cy="step-composer-pending"/);
    expect(comp).toMatch(/asstChat\.stepComposer\.rewriting/);
  });

  test("REQ-442: the island echoes the correction and announces the first turn to the list", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/echoWithCorrection\(/);
    expect(src).toMatch(/publishThreadTurn\(/);
    const list = read("front-end/islands/AsstThreads.tsx");
    expect(list).toMatch(/THREAD_TURN_EVENT/);
  });
});
