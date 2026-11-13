/**
 * REQ-671 — demo-loop cycle 5 (run r37f88707), issue p8 "Header says 'New
 * conversation' after the job is described".
 *
 * RCA (CONFIRMED, skeptic UPHELD at 2444608a): the header's title is
 * `deriveChatHeader` → job name, then customer, then the stored conversation
 * title (REQ-447) — but the chat only learned that stored title from a chat
 * turn's response (`setConvTitle(turnTitle)` in the turn runner). The
 * details-first flow ("I know the job, help me price it" / "I know my
 * price") titles the thread through `ensureConversationForDraft` → POST
 * :id/draft { note }, and REQ-580 handed that title to the LIST only
 * (publishThreadTurn). So through the job, options and pricing steps the
 * sidebar named the thread while the header still said "New conversation"
 * (fleet-6 stdout:294-295), until a later chat turn (the rewrite) set it.
 *
 * Target: every landed turn that carries the server's title — the draft
 * note, a wizard answer, a chat turn — hands it to the header too, through
 * the same reader the list uses (`threadTurnTitle`).
 */
import * as fs from "fs";
import * as path from "path";
import { threadTurnTitle } from "../../front-end/lib/thread-status-sync";
import { deriveChatHeader } from "../../shared/quote-flow/chat-header";

const ROOT = path.resolve(__dirname, "../..");
const chat = fs.readFileSync(
  path.join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const fnBody = (name: string) => {
  const at = chat.indexOf(`function ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const rest = chat.slice(at);
  return rest.slice(0, rest.indexOf("\n  }\n"));
};

describe("REQ-671 (cycle 5, p8): the header names the thread once the job is described", () => {
  test("REQ-671: threadTurnTitle reads the server row's title, never a blank one", () => {
    expect(threadTurnTitle({ title: "ok so this is for the Hendersons" }))
      .toBe("ok so this is for the Hendersons");
    expect(threadTurnTitle({ title: "   " })).toBeUndefined();
    expect(threadTurnTitle({ preview: "x" })).toBeUndefined();
    expect(threadTurnTitle(undefined)).toBeUndefined();
    expect(threadTurnTitle(null)).toBeUndefined();
  });

  test("REQ-671: with the draft's title and no quote yet, the header is that title, not 'New conversation'", () => {
    const h = deriveChatHeader({
      title: threadTurnTitle({ title: "Gut master bath, Hendersons" }),
      quote: null,
      messages: [],
    });
    expect(h.clientName).toBe("Gut master bath, Hendersons");
    expect(h.clientKey).toBeUndefined();
  });

  test("REQ-671: the details-first draft note hands its title to the header, after the save", () => {
    const body = fnBody("ensureConversationForDraft");
    const post = body.indexOf("/draft`");
    const adopt = body.indexOf("adoptTurnTitle(");
    expect(post).toBeGreaterThan(-1);
    expect(adopt).toBeGreaterThan(post);
  });

  test("REQ-671: a wizard answer hands the server's title to the header too", () => {
    const body = fnBody("postWizardAnswer");
    const ans = body.indexOf("assistantClient.answerWizard(");
    const adopt = body.indexOf("adoptTurnTitle(");
    expect(ans).toBeGreaterThan(-1);
    expect(adopt).toBeGreaterThan(ans);
  });

  test("REQ-671: adoptTurnTitle sets the header's title through threadTurnTitle", () => {
    const body = fnBody("adoptTurnTitle");
    expect(body).toMatch(/threadTurnTitle\(/);
    expect(body).toMatch(/setConvTitle\(/);
  });
});
