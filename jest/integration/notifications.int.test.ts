/**
 * PDF p8 — "Post Quotes/Signed Quotes we need to send a completion Text and
 * Email": after a quote is sent, and again after it is signed, BOTH an email
 * and an SMS must go out (recorded in the communication log; Postmark/Twilio
 * are silent in dev, so the log is the observable).
 *
 * PDF p13 — the email SUBJECT must not contain quotation marks and must use
 * the job name.
 */
import { anonymous, contractor, seedQuote, type ApiSession } from "./helpers/api";

type LoggedMessage = {
  channel?: string; // "email" | "sms"
  kind?: string;
  to?: string;
  subject?: string;
  body?: string;
  paperworkId?: string;
  quoteId?: string;
};

async function messagesFor(s: ApiSession, quoteId: string): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const all: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return all.filter((m) => JSON.stringify(m).includes(quoteId));
}

describe("completion notifications (text + email)", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await contractor("+15125550918");
    quoteId = await seedQuote(s, { jobName: "Backyard Junk Removal" });
  });

  it("sending the quote produces BOTH an email and a text to the customer", async () => {
    const send = await s.post(`/quotes/${quoteId}/email`);
    expect(send.status).toBeLessThan(400);
    const text = await s.post(`/quotes/${quoteId}/text`);
    expect(text.status).toBeLessThan(400);

    const logged = await messagesFor(s, quoteId);
    const channels = new Set(logged.map((m) => m.channel ?? m.kind));
    expect(channels.has("email")).toBe(true);
    expect(channels.has("text")).toBe(true); // "text" is the app's SMS channel (dto/message.ts)
  });

  it("the quote email subject uses the job name WITHOUT quotation marks", async () => {
    const logged = await messagesFor(s, quoteId);
    const email = logged.find((m) => (m.channel ?? m.kind) === "email" && m.subject);
    expect(email).toBeDefined();
    expect(email!.subject!).toContain("Backyard Junk Removal");
    expect(email!.subject!).not.toMatch(/["“”]/);
  });

  it("after the customer signs, a completion email AND text go out", async () => {
    const before = (await messagesFor(s, quoteId)).length;

    const sign = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    expect(sign.status).toBeLessThan(400);

    const after = await messagesFor(s, quoteId);
    expect(after.length).toBeGreaterThan(before);
    const newOnes = after.slice(before);
    const channels = new Set(newOnes.map((m) => m.channel ?? m.kind));
    expect(channels.has("email")).toBe(true);
    expect(channels.has("text")).toBe(true); // "text" is the app's SMS channel (dto/message.ts)
  });
});
