/**
 * PDF p8 — "Settings — Make the rest of the stuff editable":
 *   - Mailing Address
 *   - Allow for Insurance to be uploaded
 *   - Tax W-9
 */
import { contractor, type ApiSession } from "./helpers/api";

describe("settings editability", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550916");
  });

  it("mailing address round-trips through PUT /profile/address", async () => {
    const addr = {
      street: "123 Main St",
      unit: "Suite 4",
      city: "Austin",
      state: "TX",
      zip: "78701",
    };
    const put = await s.put("/profile/address", addr);
    expect(put.status).toBeLessThan(400);
    const { body } = await s.get("/profile/address");
    expect(body.street).toBe("123 Main St");
    expect(body.city).toBe("Austin");
    expect(body.zip).toBe("78701");
  });

  it("insurance can be saved and read back", async () => {
    const put = await s.put("/profile/insurance", {
      carrier: "Acme Mutual",
      policyNumber: "PN-123456",
      expiresAt: "2027-01-31",
      fileId: null,
    });
    expect(put.status).toBeLessThan(400);
    const { body } = await s.get("/profile/insurance");
    expect(body.carrier).toBe("Acme Mutual");
    expect(body.policyNumber).toBe("PN-123456");
  });

  it("W-9 tax info can be saved, read and deleted", async () => {
    const put = await s.put("/profile/tax", {
      w9: { businessName: "JEST LLC", tinLast4: "1234", classification: "LLC" },
    });
    expect(put.status).toBeLessThan(400);

    const read = await s.get("/profile/tax");
    expect(JSON.stringify(read.body)).toMatch(/JEST LLC/);

    const del = await s.del("/profile/tax/w9");
    expect(del.status).toBeLessThan(400);
  });
});
