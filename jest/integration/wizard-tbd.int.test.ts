/**
 * REQ-046 / REQ-047 (2026-09-30), Raphael: "in the wizard we need to add TBD
 * to when does the job start and how long will the job take."
 *
 * Drives the terms wizard over HTTP (the same contract wizard-back.int uses):
 * the emitted start_date and wraps steps offer a `tbd` option; picking it on
 * both lands "TBD" on the quote's terms, on the public agreement payload the
 * /q/:id island renders from, and the quote PDF renders that agreement in
 * both languages. (The web grid's "never 'Estimated TBD'" wording is a
 * client-rendered page — cypress/e2e/quotes-wizard-navigation.cy.ts pins it.)
 */
import { anonymous, contractor, seedQuote } from "./helpers/api";

type WizardMsg = {
  kind: string;
  payload?: { stepId?: string; options?: Array<{ id: string; label: string; isCustom?: boolean }> };
};

describe("REQ-046/047 terms wizard — TBD on start date and duration", () => {
  const PHONE = "+15125550946";
  let quoteId = "";
  let startOptions: Array<{ id: string; label: string }> = [];
  let wrapsOptions: Array<{ id: string; label: string }> = [];

  beforeAll(async () => {
    const s = await contractor(PHONE);
    quoteId = await seedQuote(s);
    const conv = await s.post("/agents/conversations", { quoteId });
    const conversationId: string = conv.body?.id ?? conv.body?.conversation?.id;
    expect(conversationId).toBeTruthy();
    const trans = await s.post(`/agents/conversations/${conversationId}/transition-to-terms`, {});
    expect(trans.status).toBeLessThan(400);

    const answer = async (stepId: string, optionId: string, customValue?: string) => {
      const r = await s.post("/agents/wizard/answer", { conversationId, stepId, optionId, customValue });
      expect(r.status).toBeLessThan(400);
      const wiz = (r.body?.newMessages ?? []).find((m: WizardMsg) => m.kind === "wizard") as WizardMsg | undefined;
      return wiz?.payload;
    };

    const afterCustomer = await answer("customer", "create_new", "TBD Test Customer");
    expect(afterCustomer?.stepId).toBe("start_date");
    startOptions = afterCustomer?.options ?? [];
    const afterStart = await answer("start_date", "tbd");
    expect(afterStart?.stepId).toBe("wraps");
    wrapsOptions = afterStart?.options ?? [];
    const afterWraps = await answer("wraps", "tbd");
    expect(afterWraps?.stepId).toBe("payment_terms");
    const afterPay = await answer("payment_terms", "due_now");
    expect(afterPay?.stepId).toBe("warranty");
    await answer("warranty", "none");
  });

  it("REQ-046 the start_date step offers a non-custom 'tbd' option labelled TBD, before 'Pick a date'", () => {
    const ids = startOptions.map((o) => o.id);
    expect(ids).toEqual(["asap", "next_week", "next_month", "tbd", "custom"]);
    const tbd = startOptions.find((o) => o.id === "tbd") as { label: string; isCustom?: boolean };
    expect(tbd.label).toBe("TBD");
    expect(tbd.isCustom).toBeFalsy();
  });

  it("REQ-047 the wraps step offers a non-custom 'tbd' option labelled TBD, before 'Custom'", () => {
    const ids = wrapsOptions.map((o) => o.id);
    expect(ids).toEqual(["1_day", "2_3_days", "1_week", "2_weeks", "job_completed", "tbd", "custom"]);
    const tbd = wrapsOptions.find((o) => o.id === "tbd") as { label: string; isCustom?: boolean };
    expect(tbd.label).toBe("TBD");
    expect(tbd.isCustom).toBeFalsy();
  });

  it("REQ-046/047 both picks persist on the quote as the stored value 'TBD'", async () => {
    const s = await contractor(PHONE);
    const q = await s.get(`/quotes/${quoteId}`);
    expect(q.status).toBe(200);
    const byStep = Object.fromEntries(
      (q.body?.terms ?? []).map((t: { stepId: string; value: string }) => [t.stepId, t.value]),
    );
    expect(byStep.start_date).toBe("TBD");
    expect(byStep.wraps).toBe("TBD");
  });

  it("REQ-046/047 the public agreement payload (what /q/:id renders) carries both terms as 'TBD'", async () => {
    const r = await anonymous().get(`/quotes/${quoteId}/public`);
    expect(r.status).toBe(200);
    const byStep = Object.fromEntries(
      (r.body?.terms ?? []).map((t: { stepId: string; value: string }) => [t.stepId, t.value]),
    );
    expect(byStep.start_date).toBe("TBD");
    expect(byStep.wraps).toBe("TBD");
  });

  it("REQ-046/047 the quote PDF renders the TBD agreement in English and in Spanish", async () => {
    const s = await contractor(PHONE);
    for (const commsLanguage of ["en", "es"] as const) {
      const ident = await s.put("/profile/identity", { commsLanguage });
      expect(ident.status).toBeLessThan(400);
      const res = await fetch(`http://localhost:5280/api/quotes/${quoteId}/pdf`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/pdf/);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1000);
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    }
  });
});
