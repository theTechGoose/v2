/**
 * REQ-038 — NW-06b (p5): "Make sure the 'From' block includes email and
 * website when the Dragon has provided them." The website did not exist in
 * the data model. It is saved through PUT /profile/identity and surfaces on
 * the public quote's contractor projection, which every From surface reads.
 */
import { contractor, seedQuote } from "./helpers/api";

const BASE = process.env.API_BASE_URL ?? "http://localhost:5280/api";

describe("REQ-038 NW-06b business website reaches the public contractor projection", () => {
  it("REQ-038 PUT /profile/identity { websiteUrl } → GET /quotes/:id/public contractor.websiteUrl", async () => {
    const s = await contractor("+15125550904");
    const put = await s.put("/profile/identity", {
      businessName: "HANS LLC",
      websiteUrl: "https://hans.work",
    });
    expect(put.status).toBe(200);
    expect(put.body.websiteUrl).toBe("https://hans.work");

    const quoteId = await seedQuote(s);
    const r = await fetch(`${BASE}/quotes/${quoteId}/public`);
    expect(r.status).toBe(200);
    const pub = await r.json();
    expect(pub.contractor?.websiteUrl).toBe("https://hans.work");
  });
});
