/**
 * REQ-741 — demo-loop cycle 5 (run r37f88707), issue p18-6b: "Gamified copy ('TODAY'S LOOP',
 * 'Top of the leaderboard', '0 ON THE BOOKS', '1 trabajo activo · activo.')".
 *
 * RCA (analyst CONFIRMED, skeptic UPHELD at 2444608a):
 *   - the en dictionary words three dashboard / customers labels as game jargon:
 *     loopBar.label "Today's loop", topClients.title "Top of the leaderboard" (es already says
 *     "Tus mejores clientes" since REQ-595), kpis.activeJobs.sub "on the books" under a 0 count;
 *   - the customer card's story line is "{n} trabajo activo · {sub}." with sub = the jobs kind,
 *     and the backend (build-customer-cards) sets jobsSub = "active" exactly when activeJobs > 0,
 *     so the line repeats itself: "1 trabajo activo · activo." / "1 active job · active.".
 */
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import type { CustomerCard } from "../../front-end/clients/clients";
import * as display from "../../front-end/lib/clients-display";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const NOW = Date.parse("2026-11-12T10:00:00Z");

const active = {
  id: "c1",
  userId: "u",
  name: "Ana Pérez",
  createdAt: "2026-11-01T09:00:00Z",
  updatedAt: "2026-11-01T09:00:00Z",
  lastWhen: "2026-11-11T09:00:00Z",
  lastTone: "hot",
  balanceCents: 0,
  balanceSub: "",
  activeJobs: 1,
  jobsSub: "active",
  status: "active",
  temp: 100,
  daysSinceContact: 1,
  revenue12moCents: 0,
} as unknown as CustomerCard;

describe("REQ-741 plain dashboard copy, no game jargon (cycle 5, p18-6b)", () => {
  it("REQ-741 the customers card title says 'Your top customers' in en, matching es", () => {
    expect(EN["topClients.title"]).toBe("Your top customers");
    expect(ES["topClients.title"]).toBe("Tus mejores clientes");
  });

  it("REQ-741 the loop bar is labelled 'Today' / 'Hoy'", () => {
    expect(EN["loopBar.label"]).toBe("Today");
    expect(ES["loopBar.label"]).toBe("Hoy");
  });

  it("REQ-741 the active-jobs KPI sub reads 'in progress' / 'en curso'", () => {
    expect(EN["kpis.activeJobs.sub"]).toBe("in progress");
    expect(ES["kpis.activeJobs.sub"]).toBe("en curso");
  });

  it("REQ-741 no en/es string on these surfaces uses leaderboard / loop / on-the-books jargon", () => {
    for (const k of ["topClients.title", "loopBar.label", "kpis.activeJobs.sub"]) {
      expect(EN[k]).not.toMatch(/leaderboard|loop|on the books/i);
      expect(ES[k]).not.toMatch(/ranking|ronda|agenda/i);
    }
  });
});

describe("REQ-741 the active customer's story line does not repeat 'active' (cycle 5, p18-6b)", () => {
  it("REQ-741 one active job reads '1 trabajo activo.' / '1 active job.' — no '· activo'", () => {
    expect(display.storyLineFor(active, "es", NOW)).toBe("1 trabajo activo.");
    expect(display.storyLineFor(active, "en", NOW)).toBe("1 active job.");
  });

  it("REQ-741 several active jobs read '3 trabajos activos.' / '3 active jobs.'", () => {
    const three = { ...active, activeJobs: 3 } as CustomerCard;
    expect(display.storyLineFor(three, "es", NOW)).toBe("3 trabajos activos.");
    expect(display.storyLineFor(three, "en", NOW)).toBe("3 active jobs.");
  });

  it("REQ-741 an overdue job keeps its sub: that is new information", () => {
    const overdue = { ...active, activeJobs: 2, jobsSub: "overdue" } as unknown as CustomerCard;
    expect(display.storyLineFor(overdue, "es", NOW)).toBe("2 trabajos activos · vencido.");
    expect(display.storyLineFor(overdue, "en", NOW)).toBe("2 active jobs · overdue.");
  });

  it("REQ-741 no story line in either language says the jobs kind twice", () => {
    for (const lang of ["en", "es"] as const) {
      for (const n of [1, 2]) {
        const line = display.storyLineFor({ ...active, activeJobs: n } as CustomerCard, lang, NOW);
        expect(line).not.toMatch(/activ[oe]s? · activ/i);
      }
    }
  });
});
