/**
 * P-59 — the activity feed must render in the VIEWER's current language, not
 * frozen in the language the event was materialized in.
 *
 * Root cause (backend/src/communication/domain/coordinators/notify-on-event/
 * mod.ts:66): the notification `title` is materialized once, as prose, from
 * `event.data.language ?? "en"` — a customer-driven event (the public accept)
 * carries no language, so the title is FROZEN in English and stored. A Spanish
 * viewer then sees English event prose in their feed; flipping languages never
 * re-localizes it.
 *
 * Verified live: with the contractor set to "es", accepting a quote produces the
 * notification title "Green Goblin accepted your quote" (English) — shown as-is
 * to the Spanish viewer.
 *
 * Desired: the feed returns viewer-localized strings (or key+params the FE
 * localizes), so an ES viewer sees Spanish and every string is capitalized.
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedQuote,
} from "./helpers/api";

const PHONE = "+15125553100";

type Notif = { title?: string; type?: string; entityId?: string };

async function feed(s: ApiSession): Promise<Notif[]> {
  // Retry a few times: the event→notification write may land just after the
  // accept response (no sleep helper in this harness).
  for (let i = 0; i < 5; i++) {
    const { body } = await s.get("/notifications?limit=20");
    const items: Notif[] = Array.isArray(body) ? body : body?.items ?? [];
    if (items.length > 0) return items;
  }
  return [];
}

// English event prose an ES viewer's feed must NOT contain.
const ENGLISH_EVENT_PROSE =
  /\b(accepted|signed|declined|approved|paid|overdue)\b|your quote|the contract/i;

describe("P-59 activity feed renders in the viewer's language", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await contractor(PHONE);
    // Viewer is Spanish.
    const me = await s.get("/me");
    await s.put("/me", {
      name: me.body?.name ?? "Jest Contractor",
      email: me.body?.email ?? "jest.contractor@blackhole.postmarkapp.com",
      language: "es",
    });
    quoteId = await seedQuote(s);
    // Public (anonymous) accept → materializes the "quote_accepted" event.
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    expect(accept.status).toBeLessThan(400);
  });

  it("P-59 the accept surfaced an event in the feed", async () => {
    const items = await feed(s);
    expect(items.length).toBeGreaterThan(0);
    // The customer name proves the accept event reached the feed.
    expect(items.some((n) => (n.title ?? "").includes("Green Goblin"))).toBe(
      true,
    );
  });

  it("P-59 the ES viewer's feed shows Spanish, not frozen English event prose", async () => {
    const items = await feed(s);
    expect(items.length).toBeGreaterThan(0);
    for (const n of items) {
      const title = n.title ?? "";
      // Desired: an ES viewer sees Spanish event strings.
      expect(title).not.toMatch(ENGLISH_EVENT_PROSE);
      // Every event string starts with a sentence-initial capital.
      const firstAlpha = title.replace(/^[^A-Za-zÀ-ÿ]+/, "").charAt(0);
      if (firstAlpha) expect(firstAlpha).toBe(firstAlpha.toUpperCase());
    }
  });
});
