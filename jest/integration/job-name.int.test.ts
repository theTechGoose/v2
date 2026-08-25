/**
 * PDF p8 — Job Name: ≤ 3 words, generated from the job details, and
 * CONSISTENT across the platform: the quote, the agreement projection and the
 * invoice must all carry the same jobName.
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedQuote,
} from "./helpers/api";

const THREE_WORDS_MAX = (s: string) => s.trim().split(/\s+/).length <= 3;

describe("job name generation + platform-wide consistency", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550912");
  });

  it("polish step derives a ≤3-word jobName from raw details", async () => {
    const { status, body } = await s.post("/agents/job-details/polish", {
      details: "Removing junk from a backyard and making sure no trash remains",
    });
    expect(status).toBe(200);
    expect(typeof body.jobName).toBe("string");
    expect(THREE_WORDS_MAX(body.jobName)).toBe(true);
  });

  it("a stored quote exposes its jobName on both private and public reads", async () => {
    const quoteId = await seedQuote(s, { jobName: "Backyard Junk Removal" });
    const priv = await s.get(`/quotes/${quoteId}`);
    const pub = await anonymous().get(`/quotes/${quoteId}/public`);
    expect(priv.body.jobName).toBe("Backyard Junk Removal");
    expect(pub.body.jobName).toBe("Backyard Junk Removal");
  });

  it("the invoice raised from a quote carries the SAME jobName", async () => {
    const quoteId = await seedQuote(s, { jobName: "Backyard Junk Removal" });
    const inv = await s.post("/invoices", {
      quoteId,
      lineItems: [{
        description: "Junk removal",
        quantity: 1,
        unit: "job",
        price: 55000,
      }],
      totalCents: 55000,
    });
    expect(inv.status).toBeLessThan(400);
    const read = await s.get(`/invoices/${inv.body.id}`);
    expect(read.body.jobName).toBe("Backyard Junk Removal");
  });
});
