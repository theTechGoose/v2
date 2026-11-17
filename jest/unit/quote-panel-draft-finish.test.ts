/**
 * REQ-686 (demo-loop cycle 5, issues m44 + m45).
 *
 * m44 — a draft quote's /quotes panel had no Send and no way back to the
 * thread where it is finished; its ledger still offered "Create next
 * invoice" and "Remaining to invoice $15,400" on a quote nobody was sent.
 * m45 — a sent quote with a pending revision showed the header Send ▾ next
 * to "Publish revision and notify customer" (the same action), and the
 * version history said "Version 1 · published Nov 12 by …" on a never-sent
 * draft.
 */
import * as fs from "fs";
import * as path from "path";
import {
  finishDraftPath,
  panelCanSend,
  panelSendAction,
} from "../../front-end/lib/quote-panel-send.ts";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-686 m44/m45 panelSendAction: the panel's one send-shaped primary", () => {
  it("REQ-686 a draft gets 'Finish & send' (it is finished in its own thread)", () => {
    expect(panelSendAction({ status: "draft" })).toBe("finish");
    expect(panelSendAction({})).toBe("finish");
  });
  it("REQ-686 a sent / viewed quote with no pending revision gets Send ▾", () => {
    expect(panelSendAction({ status: "sent", sentAt: "2026-11-01" })).toBe(
      "send",
    );
    expect(panelSendAction({ status: "viewed", sentAt: "2026-11-01" })).toBe(
      "send",
    );
  });
  it("REQ-686 m45 while a revision waits, no header Send — 'Publish revision' is the one primary", () => {
    const q = {
      status: "sent",
      sentAt: "2026-11-01",
      pendingRevision: { estimatedTotal: 120000 },
    };
    expect(panelSendAction(q)).toBe("none");
    expect(panelCanSend(q)).toBe(false);
    // an empty pendingRevision is no revision
    expect(panelSendAction({ ...q, pendingRevision: {} })).toBe("send");
  });
  it("REQ-686 the onboarding sample, a signed and a lost quote get neither", () => {
    expect(panelSendAction({ status: "draft", isSample: true })).toBe("none");
    expect(
      panelSendAction({ status: "accepted", acceptedAt: "2026-11-02" }),
    ).toBe("none");
    expect(panelSendAction({ status: "lost", sentAt: "2026-11-01" })).toBe(
      "none",
    );
  });
});

describe("REQ-686 m44 finishDraftPath: the quote's own assistant thread", () => {
  it("REQ-686 opens the thread already bound to the quote", async () => {
    const started: unknown[] = [];
    const href = await finishDraftPath("q1", "c1", {
      list: async () => [{ id: "t/9", quoteId: "q1" }],
      start: async (b) => {
        started.push(b);
        return { id: "new" };
      },
    });
    expect(href).toBe("/assistant/t%2F9");
    expect(started).toEqual([]);
  });
  it("REQ-686 starts one bound to the quote and its customer when none exists", async () => {
    const started: unknown[] = [];
    const href = await finishDraftPath("q1", "c1", {
      list: async () => [],
      start: async (b) => {
        started.push(b);
        return { id: "conv-7" };
      },
    });
    expect(href).toBe("/assistant/conv-7");
    expect(started).toEqual([{ quoteId: "q1", customerId: "c1" }]);
  });
});

describe("REQ-686 m44 ledgerSummary: nothing to invoice on an unsent draft", () => {
  const base = {
    agreementTotalCents: 1540000,
    invoicedCents: 0,
    paidCents: 0,
    invoicedUnpaidCents: 0,
    remainingToInvoiceCents: 1540000,
    overpaidCents: 0,
  };
  it("REQ-686 a draft: no 'Remaining to invoice' row, no Create next invoice", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary({
      ...base,
      quote: {
        id: "q",
        number: "Q-001",
        version: 1,
        status: "draft",
        accepted: false,
        url: "/q/q",
      },
    });
    expect(s.issued).toBe(false);
    expect(s.canCreateNextInvoice).toBe(false);
    expect(s.rows.map((r: { key: string }) => r.key)).not.toContain(
      "remaining",
    );
  });
  it("REQ-686 a sent quote keeps both", () => {
    const { ledgerSummary } = lv();
    const s = ledgerSummary({
      ...base,
      quote: {
        id: "q",
        number: "Q-001",
        version: 1,
        status: "sent",
        accepted: false,
        url: "/q/q",
      },
    });
    expect(s.issued).toBe(true);
    expect(s.canCreateNextInvoice).toBe(true);
    expect(s.rows.map((r: { key: string }) => r.key)).toContain("remaining");
  });
});

describe("REQ-686 m45 versionHistoryLine: a never-published version says so", () => {
  it("REQ-686 'Version 1 · draft, not sent' (en) / 'Versión 1 · borrador, sin enviar' (es)", () => {
    const { versionHistoryLine } = lv();
    const v = { version: 1, publishedBy: { name: "Aisha Bello" } };
    expect(versionHistoryLine(v, "en")).toBe("Version 1 · draft, not sent");
    expect(versionHistoryLine(v, "es")).toBe(
      "Versión 1 · borrador, sin enviar",
    );
  });
});

describe("REQ-686 the /quotes panel wiring", () => {
  const src = read("front-end/islands/QuotesPage.tsx");
  it("REQ-686 m44 the draft panel renders a primary 'Finish & send' that opens the quote's thread", () => {
    const at = src.indexOf('data-cy="quote-panel-finish"');
    expect(at).toBeGreaterThan(-1);
    const btn = src.slice(at - 800, at + 1200);
    expect(btn).toContain("qopen__btn--primary");
    expect(btn).toContain("finishDraftPath(");
    expect(btn).toContain("quotesPage.open.finishSend");
  });
  it("REQ-686 m45 the header Send ▾ is gated on panelSendAction (pending revision hides it)", () => {
    expect(src).toContain('panelSendAction(q) === "send"');
    expect(src).toContain('panelSendAction(q) === "finish"');
  });
  it("REQ-686 m44 Create next invoice renders only on an issued quote", () => {
    const at = src.indexOf("summary.canCreateNextInvoice");
    expect(src.slice(at - 300, at)).toContain("summary.issued");
  });
  it.each(["quotesPage.open.finishSend", "quotesPage.open.finishSendError"])(
    "REQ-686 %s exists in en and es and differs",
    (k) => {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    },
  );
});
