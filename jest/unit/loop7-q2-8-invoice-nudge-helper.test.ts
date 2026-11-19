/**
 * REQ-1031 (LOOP-007 cycle 2, q2-8) — the shared nudge sender
 * (front-end/lib/invoice-nudge.ts) that both the /invoices card's "Send a
 * nudge" and the customer page's Remind use: it POSTs the reminder cadence
 * /api/cron/invoice-reminder with {invoiceId, day} — never the first-send
 * /api/invoices/:id/email|text — and maps the reply to the nudge wording.
 */
import {
  nudgeDayFor,
  previewInvoiceNudge,
  sendInvoiceNudge,
} from "../../front-end/lib/invoice-nudge";

type Call = { url: string; init: RequestInit };

function stubFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      body: null,
    };
  }) as unknown as typeof fetch;
  return { calls, fn };
}

describe("REQ-1031 q2-8 sendInvoiceNudge sends the reminder nudge", () => {
  it("REQ-1031 POSTs /api/cron/invoice-reminder with {invoiceId, day}, never the first-send endpoints", async () => {
    const { calls, fn } = stubFetch(200, { channels: ["email"] });
    const note = await sendInvoiceNudge("inv-1", 7, fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/cron/invoice-reminder");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      invoiceId: "inv-1",
      day: 7,
    });
    expect(calls.some((c) => /\/api\/invoices\/[^/]+\/(email|text)/.test(c.url)))
      .toBe(false);
    expect(note).toEqual({ tone: "note", key: "invoicesPage.nudge.sent" });
  });

  it("REQ-1031 maps a reply that reached nobody, a failed request and a network error", async () => {
    expect(
      await sendInvoiceNudge("i", 3, stubFetch(200, { reason: "no_recipient" }).fn),
    ).toEqual({ tone: "fail", key: "invoicesPage.nudge.noRecipient" });
    expect(
      await sendInvoiceNudge("i", 3, stubFetch(200, { reason: "already_fired" }).fn),
    ).toEqual({ tone: "note", key: "invoicesPage.nudge.alreadySent" });
    expect(await sendInvoiceNudge("i", 3, stubFetch(500, {}).fn)).toEqual({
      tone: "fail",
      key: "invoicesPage.nudge.failed",
    });
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await sendInvoiceNudge("i", 3, boom)).toEqual({
      tone: "fail",
      key: "invoicesPage.nudge.failed",
    });
  });

  it("REQ-1031 the step follows REQ-704's manual rungs", () => {
    expect(nudgeDayFor("2026-11-20", "2026-11-19")).toBe(-3);
    expect(nudgeDayFor("2026-11-19", "2026-11-19")).toBe(0);
    expect(nudgeDayFor("2026-11-09", "2026-11-19")).toBe(7);
    expect(nudgeDayFor("2026-10-01", "2026-11-19")).toBe(14);
  });

  it("REQ-1031 the preview asks /api/cron/reminder-preview and sends nothing", async () => {
    const { calls, fn } = stubFetch(200, { smsBody: "Reminder: INV-1" });
    expect(await previewInvoiceNudge("inv-1", 3, fn)).toEqual({
      smsBody: "Reminder: INV-1",
    });
    expect(calls.map((c) => c.url)).toEqual(["/api/cron/reminder-preview"]);
  });
});
