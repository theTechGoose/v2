/**
 * REQ-237 (demo issue M17) — the assistant review/send card said "Add the
 * job details" and dropped the line item on a chat-drafted quote.
 *
 * A quote drafted in chat (create_quote) is stored with summary + lineItems
 * and NO description; the review card read job details from the description
 * only, so "Pintura de baño $450" vanished while TOTAL $450 stayed.
 *
 * Target: shared/quote-flow/review-job-details.ts (reviewJobDetails), the
 * resolver AsstChat's review card renders.
 */
import * as fs from "fs";
import * as path from "path";
import { reviewJobDetails } from "../../shared/quote-flow/review-job-details";

describe("REQ-237 M17 review card job details", () => {
  it("REQ-237: a chat-drafted quote (no description) shows its line items with their amounts", () => {
    const rows = reviewJobDetails({
      previewLang: "es",
      descriptionByLang: undefined,
      lockedDescription: undefined,
      description: undefined,
      lineItems: [{ description: "Pintura de baño", amountCents: 45_000 }],
    });
    expect(rows).toEqual([{ text: "Pintura de baño", amountCents: 45_000 }]);
  });

  it("REQ-237: several line items keep their order; blank ones are skipped", () => {
    const rows = reviewJobDetails({
      previewLang: "en",
      description: "   ",
      lineItems: [
        { description: "Surface prep + grind", amountCents: 84_000 },
        { description: "  ", amountCents: 0 },
        { description: " Polyaspartic 3-coat ", amountCents: 168_000 },
      ],
    });
    expect(rows).toEqual([
      { text: "Surface prep + grind", amountCents: 84_000 },
      { text: "Polyaspartic 3-coat", amountCents: 168_000 },
    ]);
  });

  it("REQ-237: a description still wins (the 'I know my price' flow), in the preview language first", () => {
    const items = [{ description: "Line", amountCents: 100 }];
    expect(
      reviewJobDetails({
        previewLang: "es",
        descriptionByLang: { es: "• Quitar azulejo\n• Pintar" },
        description: "• Remove tile\n• Paint",
        lineItems: items,
      }),
    ).toEqual([{ text: "Quitar azulejo" }, { text: "Pintar" }]);
    expect(
      reviewJobDetails({
        previewLang: "en",
        lockedDescription: "Locked copy",
        description: "Stored copy",
        lineItems: items,
      }),
    ).toEqual([{ text: "Locked copy" }]);
  });

  it("REQ-237: nothing at all is still empty (the card shows 'Add the job details')", () => {
    expect(reviewJobDetails({ previewLang: "en", lineItems: [] })).toEqual([]);
    expect(reviewJobDetails({ previewLang: "en" })).toEqual([]);
  });

  it("REQ-237: the review card renders the resolver's rows, with a row's amount when it has one", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../front-end/islands/AsstChat.tsx"),
      "utf8",
    );
    expect(src).toMatch(/reviewJobDetails\(\{[\s\S]{0,400}lineItems/);
    expect(src).toMatch(/data-cy="review-job-detail-amount"/);
  });
});

/**
 * REQ-1049 (LOOP-007 cycle 2, q2-34) — the owner's "Ready to send" preview of
 * a quote that has BOTH a job-details description (the job-details pick) and
 * three priced lines showed only the description; the customer /q shows the
 * three priced lines ($4,200 / $900 / $1,350). The review card must list the
 * priced lines too, with their amounts.
 */
describe("REQ-1049 q2-34 review card lists priced lines alongside the description", () => {
  const Q002_LINES = [
    { description: "Mano de obra — pintura exterior", amountCents: 420_000 },
    { description: "Pintar la cerca", amountCents: 90_000 },
    { description: "Materiales", amountCents: 135_000 },
  ];
  const Q002_DESCRIPTION =
    "• Pintar el exterior de la casa, dos capas\n• También incluye la cerca del patio";

  it("REQ-1049: a description plus 3 priced lines gives rows carrying all 3 amounts (420000/90000/135000)", () => {
    const rows = reviewJobDetails({
      previewLang: "es",
      descriptionByLang: { es: Q002_DESCRIPTION },
      lockedDescription: Q002_DESCRIPTION,
      description: Q002_DESCRIPTION,
      lineItems: Q002_LINES,
    });
    const amounts = rows
      .filter((r) => typeof r.amountCents === "number")
      .map((r) => r.amountCents);
    expect(amounts).toEqual([420_000, 90_000, 135_000]);
    for (const li of Q002_LINES) {
      expect(rows).toContainEqual({
        text: li.description,
        amountCents: li.amountCents,
      });
    }
  });

  it("REQ-1049: the description is still shown (its lines come first, without amounts)", () => {
    const rows = reviewJobDetails({
      previewLang: "es",
      descriptionByLang: { es: Q002_DESCRIPTION },
      lineItems: Q002_LINES,
    });
    expect(rows.slice(0, 2)).toEqual([
      { text: "Pintar el exterior de la casa, dos capas" },
      { text: "También incluye la cerca del patio" },
    ]);
    expect(rows.length).toBe(5);
  });
});
