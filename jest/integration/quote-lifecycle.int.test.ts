/**
 * PDF p10 — status lifecycle over the REAL API:
 *   draft → (POST /quotes/:id/email) → sent
 *         → (customer GET /quotes/:id/public) → viewed
 *         → (customer POST /quotes/:id/accept with signature) → approved
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedQuote,
} from "./helpers/api";

describe("quote status lifecycle (draft → sent → viewed → accepted)", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await contractor("+15125550910");
    quoteId = await seedQuote(s);
  });

  it("a freshly created quote is a draft", async () => {
    const { body } = await s.get(`/quotes/${quoteId}`);
    expect(body.status).toBe("draft");
  });

  it("sending the quote flips status to 'sent'", async () => {
    const send = await s.post(`/quotes/${quoteId}/email`);
    expect(send.status).toBeLessThan(400);
    const { body } = await s.get(`/quotes/${quoteId}`);
    expect(body.status).toBe("sent");
  });

  it("the customer opening the public quote flips status to 'viewed'", async () => {
    const pub = await anonymous().get(`/quotes/${quoteId}/public`);
    expect(pub.status).toBe(200);
    const { body } = await s.get(`/quotes/${quoteId}`);
    expect(body.status).toBe("viewed");
  });

  it("the customer signing flips status to 'accepted'", async () => {
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    expect(accept.status).toBeLessThan(400);
    const { body } = await s.get(`/quotes/${quoteId}`);
    expect(body.status).toBe("accepted");
  });

  it("a later public view never demotes the accepted quote", async () => {
    await anonymous().get(`/quotes/${quoteId}/public`);
    const { body } = await s.get(`/quotes/${quoteId}`);
    expect(body.status).toBe("accepted");
  });
});
