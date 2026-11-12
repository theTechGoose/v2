/**
 * REQ-262 (demo M25) — when a chat turn changes the bound quote's job details
 * (the assistant's update_job_details), the server flags the reply with
 * `payload.quoteUpdated = <quoteId>`. The chat island must re-read that quote
 * so the open preview shows the new text in every language, instead of the
 * stale card the demo agent kept seeing.
 */
import * as fs from "fs";
import * as path from "path";
import { quoteUpdatedBy } from "../../front-end/lib/chat-quote-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-262 chat turn that updates the quote", () => {
  test("quoteUpdatedBy finds the flagged quote id among a turn's new messages", () => {
    expect(
      quoteUpdatedBy([
        { role: "user", kind: "text", content: "Spanish AND English" },
        {
          role: "assistant",
          kind: "text",
          content: "Done.",
          payload: { quoteUpdated: "q-1" },
        },
      ]),
    ).toBe("q-1");
  });

  test("quoteUpdatedBy ignores turns that changed nothing, user rows, and junk payloads", () => {
    expect(quoteUpdatedBy([])).toBeUndefined();
    expect(quoteUpdatedBy(undefined)).toBeUndefined();
    expect(
      quoteUpdatedBy([
        { role: "assistant", kind: "text", content: "ok" },
        {
          role: "user",
          kind: "text",
          content: "x",
          payload: { quoteUpdated: "q-9" },
        },
        {
          role: "assistant",
          kind: "text",
          content: "y",
          payload: { quoteUpdated: 7 },
        },
      ]),
    ).toBeUndefined();
  });

  test("the chat island re-reads the quote when a turn flags it", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    expect(island).toMatch(
      /import \{ quoteUpdatedBy \} from "\.\.\/lib\/chat-quote-refresh\.ts"/,
    );
    const turn = island.slice(island.indexOf("async function submitTurn("));
    const body = turn.slice(0, turn.indexOf("async function sendText("));
    expect(body).toMatch(/quoteUpdatedBy\(res\.newMessages\)/);
    expect(body).toMatch(/quotesClient\.get\(/);
  });
});
