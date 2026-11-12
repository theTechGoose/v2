/**
 * REQ-700 (demo-loop cycle 5, demo issue m20) — "Status names disagree
 * between the chat header, the list and the client card". Raphael: "fix
 * every issue the demo found, loop until there are none."
 *
 * Root cause (RCA CONFIRMED, skeptic UPHELD at 2444608a): the chat header
 * read the invoiceStatus frozen into the signing divider (AsstChat called
 * deriveChatHeader with no invoiceStatus), the list read the denormalized
 * conversation.invoiceStatus that only assistant coordinators write, and
 * threadChip had no 'scheduled' case — so a signature that scheduled the
 * bill read "Quote accepted" in the header and the list stayed "Signed ·
 * Invoiced" after the payment.
 *
 * Unit level: threadChip names every live invoice status (scheduled, sent,
 * viewed, claimed, paid) in one vocabulary, the header and the list agree for
 * each, and the island + route feed the header the server's live status.
 * The server side (ListConversations / LoadConversation reading the invoice
 * row) is `backend/src/agents/domain/coordinators/list-conversations/
 * live-invoice.int.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import {
  deriveChatHeader,
  threadChip,
} from "../../shared/quote-flow/chat-header";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const signedQuote = {
  id: "q1",
  number: "Q-001",
  jobName: "Fence",
  status: "accepted",
  acceptedAt: "2026-11-12T10:00:00.000Z",
};

function signedDivider(invoiceStatus: string) {
  return {
    role: "system",
    kind: "phase_divider",
    content: "Signed",
    payload: { phase: 4, signed: true, quoteId: "q1", invoiceStatus },
  };
}

describe("REQ-700 m20 threadChip: one vocabulary for the bill a signature created", () => {
  test("REQ-700 a signed quote whose bill is scheduled reads 'Signed · Invoice scheduled' / 'Firmada · Factura programada'", () => {
    const chip = threadChip("accepted", "scheduled");
    expect(chip?.key).toBe("asstChat.header.signedScheduled");
    expect(en[chip!.key]).toBe("Signed · Invoice scheduled");
    expect(es[chip!.key]).toBe("Firmada · Factura programada");
  });

  test("REQ-700 a bill the customer viewed or claimed is still 'Signed · Invoiced'; paid is 'Paid'", () => {
    for (const s of ["sent", "viewed", "claimed", "overdue"]) {
      expect(threadChip("accepted", s)?.key).toBe(
        "asstChat.header.signedInvoiced",
      );
    }
    expect(threadChip("accepted", "paid")?.key).toBe("status.paid");
  });

  test("REQ-700 a draft or void bill leaves the quote's own status", () => {
    expect(threadChip("accepted", "draft")?.key).toBe(
      threadChip("accepted", undefined)?.key,
    );
    expect(threadChip("accepted", "void")?.key).toBe(
      threadChip("accepted", undefined)?.key,
    );
  });
});

describe("REQ-700 m20 the header and the list say the same words for the live bill", () => {
  test("REQ-700 the signature scheduled the bill: header == list chip (not 'Quote accepted')", () => {
    const header = deriveChatHeader({
      quote: signedQuote,
      messages: [signedDivider("scheduled")],
    });
    expect(header.statusKey).toBe("asstChat.header.signedScheduled");
    expect(header.statusKey).toBe(threadChip(header.status, "scheduled")?.key);
  });

  test("REQ-700 the live status wins over the divider's snapshot: paid on /invoices reads 'Paid' in both", () => {
    const header = deriveChatHeader({
      quote: signedQuote,
      messages: [signedDivider("scheduled")],
      invoiceStatus: "paid",
    });
    expect(header.statusKey).toBe("status.paid");
    expect(threadChip(header.status, "paid")?.key).toBe(header.statusKey);
  });
});

describe("REQ-700 m20 the island and the route feed the header the server's live invoice status", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const route = read("front-end/routes/assistant/[threadId].tsx");

  test("REQ-700 AsstChat passes invoiceStatus to deriveChatHeader", () => {
    expect(chat).toMatch(
      /deriveChatHeader\(\{[\s\S]{0,400}invoiceStatus:\s*liveInvoiceStatus/,
    );
  });

  test("REQ-700 the thread route seeds the live status from the snapshot", () => {
    expect(route).toMatch(/initialInvoiceStatus=\{detail\?\.invoiceStatus\}/);
  });

  test("REQ-700 the list hands the open thread's live invoice status back to the chat", () => {
    const threads = read("front-end/islands/AsstThreads.tsx");
    expect(threads).toMatch(/THREAD_SERVER_INVOICE_EVENT/);
    expect(chat).toMatch(/THREAD_SERVER_INVOICE_EVENT/);
  });
});
