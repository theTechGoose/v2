/**
 * REQ-580 — demo-loop cycle 4 (run r857a9d67), issues p4-p2d "Conversation
 * preview lags one answer" and p4-p7b "Conversation title stays 'New
 * conversation —'".
 *
 * Root cause (RCA, CONFIRMED, skeptic UPHELD at ad104a19): the server writes
 * the thread's preview on every wizard answer and every chat turn, but the
 * sidebar (AsstThreads) re-read the list only on its 8–60 s poll, on a status
 * change, or on the thread's FIRST chat turn (REQ-442). A wizard answer, a
 * later chat turn and the details-first draft (ensureConversationForDraft →
 * POST :id/draft { note }) published nothing, so the row lagged — and the
 * draft endpoint did not title the thread at all (fixed server-side, see
 * backend thread-title.e2e.test.ts REQ-580).
 *
 * Target: every turn the chat lands (draft note, wizard answer, chat turn)
 * publishes THREAD_TURN_EVENT carrying the server's new title / preview; the
 * list patches that row in place at once (applyThreadTurn) and re-reads soon
 * after.
 */
import * as fs from "fs";
import * as path from "path";
import {
  applyThreadTurn,
  publishThreadTurn,
  THREAD_TURN_EVENT,
} from "../../front-end/lib/thread-status-sync";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const rows = [
  { id: "c-1", title: undefined as string | undefined, preview: "—" },
  { id: "c-2", title: "Fence", preview: "older" },
];

describe("REQ-580 p4-p2d / p4-p7b: the list patches the turned thread's row in place", () => {
  test("REQ-580: the new preview and title land on that row; other rows are untouched", () => {
    const next = applyThreadTurn(rows, {
      conversationId: "c-1",
      title: "Kitchen remodel",
      preview: "Net 30",
    });
    expect(next[0]).toEqual({
      id: "c-1",
      title: "Kitchen remodel",
      preview: "Net 30",
    });
    expect(next[1]).toBe(rows[1]);
  });

  test("REQ-580: a turn without a title keeps the row's title (preview only)", () => {
    const next = applyThreadTurn(rows, {
      conversationId: "c-2",
      preview: "Deposit 50%",
    });
    expect(next[1]).toEqual({
      id: "c-2",
      title: "Fence",
      preview: "Deposit 50%",
    });
  });

  test("REQ-580: blank fields never blank the row", () => {
    const next = applyThreadTurn(rows, {
      conversationId: "c-2",
      title: "  ",
      preview: "",
    });
    expect(next[1]).toEqual(rows[1]);
  });

  test("REQ-580: a turn for a thread the list doesn't hold leaves the list as is", () => {
    expect(applyThreadTurn(rows, { conversationId: "c-9", preview: "x" }))
      .toBe(rows);
  });

  test("REQ-580: publishThreadTurn carries the server's title and preview", () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    const g = globalThis as unknown as {
      dispatchEvent: (e: Event) => boolean;
    };
    const saved = g.dispatchEvent;
    g.dispatchEvent = (e) => target.dispatchEvent(e);
    try {
      target.addEventListener(
        THREAD_TURN_EVENT,
        (e) => seen.push((e as CustomEvent).detail),
      );
      publishThreadTurn("c-1", {
        id: "c-1",
        title: "Kitchen remodel",
        preview: "Net 30",
        customerId: "x",
      } as { title?: string; preview?: string });
      expect(seen).toEqual([{
        conversationId: "c-1",
        title: "Kitchen remodel",
        preview: "Net 30",
      }]);
    } finally {
      g.dispatchEvent = saved;
    }
  });
});

describe("REQ-580 wiring — every landed turn reaches the list", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const threads = read("front-end/islands/AsstThreads.tsx");
  const fnBody = (name: string) => {
    const at = chat.indexOf(`async function ${name}(`);
    expect(at).toBeGreaterThan(-1);
    const rest = chat.slice(at);
    return rest.slice(0, rest.indexOf("\n  }\n"));
  };

  test("REQ-580 p4-p7b: the details-first draft publishes the titled thread once the note is saved", () => {
    const body = fnBody("ensureConversationForDraft");
    const post = body.indexOf("/draft`");
    const pub = body.indexOf("publishThreadTurn(");
    expect(post).toBeGreaterThan(-1);
    expect(pub).toBeGreaterThan(post);
  });

  test("REQ-580 p4-p2d: every wizard answer publishes the thread's new preview", () => {
    const body = fnBody("postWizardAnswer");
    const ans = body.indexOf("assistantClient.answerWizard(");
    const pub = body.indexOf("publishThreadTurn(");
    expect(ans).toBeGreaterThan(-1);
    expect(pub).toBeGreaterThan(ans);
  });

  test("REQ-580 p4-p2d: every chat turn publishes, not only the first", () => {
    expect(chat).not.toMatch(/firstTurn && turnConvoId/);
    expect(chat).toMatch(/publishThreadTurn\(turnConvoId, res\.conversation/);
  });

  test("REQ-580: the list patches the row in place before it re-reads", () => {
    const at = threads.indexOf("addEventListener(THREAD_TURN_EVENT");
    expect(at).toBeGreaterThan(-1);
    const effect = threads.slice(threads.lastIndexOf("useEffect(", at), at);
    expect(effect).toMatch(/applyThreadTurn\(/);
    expect(effect).toMatch(/setTimeout\(refresh/);
  });
});
