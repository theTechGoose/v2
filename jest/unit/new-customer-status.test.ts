/**
 * REQ-271 — demo issue i18n-formatting-m5: a customer added a minute ago, with no quote and no
 * invoice, wore the "Regular" / "Habitual" badge on /customers. The backend's deriveStatus had no
 * "new" state and fell through to "regular"; the card's mood, story line and filter chips then
 * labelled it a regular. A customer with nothing on the books is "New customer" / "Cliente nuevo".
 *
 * The status itself is pinned by the backend's build-customer-cards tests; this pins the page's
 * side: the label, the mood, the story, the filter chip and both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import type {
  ClientStatus,
  CustomerCard,
} from "../../front-end/clients/clients";
import {
  moodFor,
  statusLabel,
  storyLineFor,
} from "../../front-end/lib/clients-display";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

describe("REQ-271 a brand-new customer is labelled new, never regular", () => {
  it("both dictionaries carry the new status label, story line and filter chip", () => {
    expect(EN["clientsDisplay.status.new"]).toBe("New customer");
    expect(ES["clientsDisplay.status.new"]).toBe("Cliente nuevo");
    expect(EN["clientsDisplay.story.new"]).toContain("{when}");
    expect(ES["clientsDisplay.story.new"]).toContain("{when}");
    expect(EN["clientsBoard.filter.new"]).toBe("New");
    expect(ES["clientsBoard.filter.new"]).toBe("Nuevos");
  });

  it("the page's status type and the backend's carry \"new\"", () => {
    expect(read("front-end/clients/clients.ts")).toMatch(
      /export type ClientStatus =[^;]*"new"/,
    );
    expect(read("backend/src/crm/dto/customer.ts")).toMatch(
      /export type CustomerStatus =[^;]*"new"/,
    );
  });

  it("clients-display gives a new customer its own label, mood and story — not the regular fallback", () => {
    const card = {
      id: "c1",
      userId: "u",
      name: "Ana Pérez",
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      lastWhen: "2026-11-11T00:00:00Z",
      lastWhenRel: "hace 1 min",
      lastTone: "hot",
      balanceCents: 0,
      balanceSub: "",
      activeJobs: 0,
      jobsSub: "",
      status: "new",
      temp: 100,
      daysSinceContact: 0,
      revenue12moCents: 0,
    } as unknown as CustomerCard;
    expect(statusLabel("new" as ClientStatus, "es")).toBe("Cliente nuevo");
    expect(statusLabel("new" as ClientStatus, "en")).toBe("New customer");
    expect(moodFor(card, "es").label).toBe("Cliente nuevo");
    expect(moodFor(card, "en").label).toBe("New customer");
    expect(moodFor(card, "es").label).not.toBe(
      ES["clientsDisplay.status.regular"],
    );
    expect(storyLineFor(card, "es")).toBe(
      ES["clientsDisplay.story.new"].replace("{when}", "hace 1 min"),
    );
    expect(storyLineFor(card, "es")).not.toContain("habitual");
  });

  it("the board offers a New filter chip", () => {
    expect(read("front-end/islands/ClientsBoard.tsx")).toMatch(
      /\{ id: "new", labelKey: "clientsBoard\.filter\.new" \}/,
    );
  });
});
