/**
 * REQ-585 (demo-loop cycle 4, M30) — pair 7 picked "Next month" on Q-002's
 * start card, then typed "oops no, empezamos la próxima semana, no el próximo
 * mes"; nothing could change an answered step and "Start: Next month" stayed
 * (fleet-6 stdout:251). The server now changes that pick IN PLACE
 * (HandleWizardAnswer.change) and sends it back in the turn's newMessages
 * with its own id. The chat island must replace the message where it sits —
 * appending it left the old "Start: Next month" in the thread and a second
 * "Start: Next week" under the reply.
 */
import * as fs from "fs";
import * as path from "path";
import { mergeTurnMessages } from "../../front-end/lib/turn-messages";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type M = { id: string; content: string };

describe("REQ-585 M30 mergeTurnMessages: a turn's messages land in the thread", () => {
  const thread: M[] = [
    { id: "w1", content: "When does the job start?" },
    { id: "p1", content: "Start: Next month" },
    { id: "w2", content: "How long will the job take?" },
  ];

  test("a message the turn changed in place replaces it where it sits; the new ones append in order", () => {
    const merged = mergeTurnMessages(thread, [
      { id: "u9", content: "oops no, empezamos la próxima semana" },
      { id: "p1", content: "Start: Next week" },
      { id: "a9", content: "Cambié la fecha de inicio: …" },
    ]);
    expect(merged.map((m) => `${m.id}:${m.content}`)).toEqual([
      "w1:When does the job start?",
      "p1:Start: Next week",
      "w2:How long will the job take?",
      "u9:oops no, empezamos la próxima semana",
      "a9:Cambié la fecha de inicio: …",
    ]);
  });

  test("a turn of new messages only is appended as before; nothing is lost or reordered", () => {
    expect(
      mergeTurnMessages(thread, [{ id: "u1", content: "hi" }]).map((m) => m.id),
    ).toEqual(["w1", "p1", "w2", "u1"]);
    expect(mergeTurnMessages([], [{ id: "u1", content: "hi" }])).toEqual([
      { id: "u1", content: "hi" },
    ]);
    expect(mergeTurnMessages(thread, [])).toEqual(thread);
  });

  test("the chat island merges a turn's newMessages by id", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    expect(island).toMatch(
      /import \{ mergeTurnMessages \} from "\.\.\/lib\/turn-messages\.ts"/,
    );
    const turn = island.slice(island.indexOf("async function submitTurn("));
    const body = turn.slice(0, turn.indexOf("async function sendText("));
    expect(body).toMatch(/mergeTurnMessages\(/);
  });
});
