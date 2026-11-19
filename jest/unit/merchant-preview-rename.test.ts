/**
 * REQ-1044 — Raphael (LOOP-007): "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then one to fix it
 * and make it green". Cycle 2, issue q2-28: after renaming the business on /settings the
 * Square (and Stripe) payment card's merchant preview keeps the old payee name until a reload.
 *
 * RCA (at 240a6443): SquarePaymentsCard / StripePaymentsCard load their status once on mount
 * (again only on connect/disconnect) and compute
 *   merchantName = status?.merchant.name || snapshot.identity?.businessName || …
 *   logoFileId   = status?.merchant.logoFileId ?? snapshot.identity?.logoFileId
 * so the cached server copy beats the live snapshot that saveIdentity already updated.
 * The server builds merchant.name from the very same identity fields, so the live snapshot
 * must win. Fix: one pure helper `merchantPreview(snapshot, status)` in
 * front-end/lib/merchant-preview.ts, used by both cards.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const HELPER = path.join(ROOT, "front-end/lib/merchant-preview.ts");

type Preview = { name: string; logoFileId?: string | null };
type Fn = (snapshot: unknown, status: unknown) => Preview;

function helper(): Fn {
  // required lazily so the source checks below still run (and fail on their own) before the fix
  if (!fs.existsSync(HELPER)) {
    throw new Error(
      "REQ-1044: front-end/lib/merchant-preview.ts (merchantPreview) does not exist",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(HELPER) as { merchantPreview?: Fn };
  if (typeof mod.merchantPreview !== "function") {
    throw new Error("REQ-1044: merchant-preview.ts exports no merchantPreview");
  }
  return mod.merchantPreview;
}

/** the body of one card function in SettingsPage.tsx */
function cardSource(name: string): string {
  const src = read("front-end/islands/SettingsPage.tsx");
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no ${name} in SettingsPage.tsx`);
  const next = src.indexOf("\nfunction ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

const staleStatus = {
  connected: true,
  merchant: { name: "Reyes Tile & Bath", hasLogo: true, logoFileId: "old-logo" },
};
const renamed = {
  user: { name: "Luis Reyes" },
  identity: { businessName: "Reyes Tile & Bath LLC", logoFileId: "new-logo" },
};

describe("REQ-1044 (LOOP-007 q2-28): the payment cards' merchant preview follows a business rename without a reload", () => {
  it("REQ-1044: merchantPreview — the live snapshot's business name beats a stale status merchant.name", () => {
    expect(helper()(renamed, staleStatus).name).toBe("Reyes Tile & Bath LLC");
  });

  it("REQ-1044: merchantPreview — a new logo in the snapshot beats the stale status logo", () => {
    expect(helper()(renamed, staleStatus).logoFileId).toBe("new-logo");
  });

  it("REQ-1044: merchantPreview — falls back legalName → user.name → status name, trimmed", () => {
    const f = helper();
    expect(
      f({ user: { name: "Luis" }, identity: { businessName: "  ", legalName: " Reyes LLC " } }, staleStatus)
        .name,
    ).toBe("Reyes LLC");
    expect(f({ user: { name: " Luis Reyes " }, identity: {} }, staleStatus).name).toBe("Luis Reyes");
    expect(f({ user: null, identity: null }, staleStatus).name).toBe("Reyes Tile & Bath");
    expect(f({ user: null, identity: null }, null).name).toBe("");
  });

  // CardPaymentsCard is the Stripe card ("Lo que tus clientes ven en la página de pago")
  for (const card of ["SquarePaymentsCard", "CardPaymentsCard"]) {
    it(`REQ-1044: ${card} does not put the cached status.merchant ahead of the live snapshot`, () => {
      const body = cardSource(card);
      const stale = [
        body.match(/merchantName\s*=\s*status\?\.merchant\.name\s*\|\|/)?.[0],
        body.match(/logoFileId\s*=\s*status\?\.merchant\.logoFileId\s*\?\?/)?.[0],
      ].filter(Boolean);
      expect(stale).toEqual([]);
    });

    it(`REQ-1044: ${card} builds its preview with merchantPreview(snapshot, status)`, () => {
      expect(/merchantPreview\(\s*snapshot\s*,\s*status\s*\)/.test(cardSource(card))).toBe(true);
    });
  }
});
