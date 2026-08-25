/// <reference types="cypress" />

/**
 * UX audit (ux-problems.md) — dashboard feed/KPI + chrome reds.
 *
 * UX-20 [DASHBOARD] "Feed/KPI panel polish. The accept event is generic ('Tu
 *   cliente aceptó tu cotización' — no name, no job, not tappable); 'Lo más
 *   alto del pipeline' renders as an empty shell with no empty-state copy;
 *   'TRABAJO PAGADO PROM.' wraps its 'Aún no hay trabajos pagados' value
 *   awkwardly as a KPI."
 * UX-21 [CHROME] "The mobile hamburger renders on desktop next to the full
 *   sidebar (two nav systems); an unlabeled icon-only button sits above
 *   'Cerrar sesión'; the top-right '● hace 4m' pill has no label or tooltip;
 *   the checklist chip 'garantía: 6 meses' is still lowercase beside
 *   capitalized siblings."
 *
 * Grounded selectors / mechanisms (read from source):
 *   activity feed    #activity .activity-item — plain <div> rows, title-only
 *                    html (front-end/components/DashSections.tsx Activity;
 *                    notifToActivity renders n.title only,
 *                    front-end/islands/DashboardPage.tsx:244-257). The accept
 *                    notification title today: "{name} aceptó tu cotización"
 *                    (titleKey notify.quote.accepted, params {name} — probed
 *                    live) — the NAME half is ALREADY green when the accept
 *                    carries a name; the JOB and the tappability are the reds.
 *   pipeline card    .qside__card containing quotesSide.topTitle "Lo más alto
 *                    del pipeline"; with zero open quotes QSideBig renders an
 *                    empty .qbig (front-end/components/QuotesSections.tsx:
 *                    221-253 — no empty-state branch).
 *   avg-job KPI      .kpi with .kpi__label kpis.avgJob.label "Trabajo pagado
 *                    prom."; zero paid history renders the full sentence
 *                    kpis.avgJob.none "Aún no hay trabajos pagados" INTO the
 *                    .kpi__val slot (front-end/components/DashSections.tsx:
 *                    130-132,191-193).
 *   hamburger        button.topbar__menu (front-end/islands/DashTopbar.tsx:
 *                    134-143) — visible at ALL widths: it is the single
 *                    sidebar toggle (collapses the rail on desktop, slides
 *                    the drawer ≤640px; the rail's own toggle was removed).
 *   icon-only button button.topbar__menu — the rail's own .sb__toggle was
 *                    removed as redundant (the topbar hamburger is the single
 *                    sidebar toggle); its aria-label (dashTopbar.toggleSidebar,
 *                    both dicts) → pinned as a labeled CONTRACT-PIN (green).
 *   ticker pill      a.topbar__ticker "● hace Xm" — has aria-label
 *                    (dashTopbar.liveActivity) but NO title tooltip for
 *                    sighted users (DashTopbar.tsx:163-181) → the red half
 *                    pins the visible tooltip.
 *   checklist chip   "Garantía: 6 meses" — label key
 *                    termsWizard.warranty.label (renamed from
 *                    contractTermsWizard.* in the Quote+Contract merge),
 *                    beside its capitalized step siblings "Cliente" /
 *                    "Pago" / "Inicio". Emitted by backend/src/agents/
 *                    domain/business/terms-wizard-spec/mod.ts. Pinned at the
 *                    dictionary (driving the full terms wizard for one chip
 *                    would be needlessly brittle; the chip renders this value
 *                    verbatim).
 *
 * Phones (slice F block): UX-20 contractor +15125556520 / customer
 * +15125556521; empty-pipeline user +15125556523; UX-21 contractor
 * +15125556522 / customer +15125556524.
 */

const FEED_PHONE = "+15125556520";
const FEED_CUSTOMER_PHONE = "+15125556521";
const CHROME_PHONE = "+15125556522";
const EMPTY_PHONE = "+15125556523";
const CHROME_CUSTOMER_PHONE = "+15125556524";

const CUSTOMER_NAME = "Rosa Jiménez";
const JOB_NAME = "Cerca Nueva";

function loginEsFresh(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

/** Seed an anonymous customer-accept so a quote_accepted notification exists
 *  (pattern from chrome-misc-polish.cy.ts P-59). */
function seedAcceptedNotification(phone: string, customerPhone: string) {
  cy.apiCreateCustomer({
    name: CUSTOMER_NAME,
    email: "rosa.ux20@blackhole.postmarkapp.com",
    phoneNumber: customerPhone,
  }).then((customerId: string) => {
    cy.apiCreateQuote({
      customerId,
      summary: "Cerca nueva de cedro",
      jobName: JOB_NAME,
      lineItems: [
        { description: "Cerca", quantity: 1, unit: "ea", price: 250_000 },
      ],
      estimatedTotal: 250_000,
    }).then((quoteId: string) => {
      cy.clearCookies();
      cy.apiAcceptQuote(quoteId, {
        signature: CUSTOMER_NAME,
        name: CUSTOMER_NAME,
      });
      cy.loginAs(phone);
      cy.apiUpdateUser({ language: "es" });
      cy.clearCookie("pm_lang");
    });
  });
}

describe("UX-20: dashboard feed and KPIs tell a specific, usable story", () => {
  beforeEach(() => {
    loginEsFresh(FEED_PHONE);
    seedAcceptedNotification(FEED_PHONE, FEED_CUSTOMER_PHONE);
    cy.visit("/dashboard");
    cy.get("#activity", { timeout: 10_000 }).should("be.visible");
  });

  it("UX-20: the accept feed event carries the customer name AND the job", () => {
    cy.contains("#activity .activity-item", /acept/i, { timeout: 10_000 })
      .invoke("text")
      .then((raw) => {
        const text = String(raw);
        // Name half — already green today (title params carry {name}); kept
        // as part of the composed contract, the JOB half is the red:
        expect(text, "accept event names the customer").to.contain(
          CUSTOMER_NAME,
        );
        // RED today: the title is "{name} aceptó tu cotización" — no job.
        expect(text, "accept event names the job").to.contain(JOB_NAME);
      });
  });

  it("UX-20: the accept feed event is tappable (an anchor/interactive row)", () => {
    cy.contains("#activity .activity-item", /acept/i, { timeout: 10_000 })
      .then(($row) => {
        const row = $row[0] as HTMLElement;
        const interactive = row.closest("a[href], button") !== null ||
          $row.find("a[href], button").length > 0 ||
          row.getAttribute("role") === "button" ||
          row.hasAttribute("tabindex");
        // RED today: Activity renders plain <div class="activity-item"> rows
        // (DashSections.tsx) — nothing to tap, nowhere to go.
        expect(interactive, "accept event row is interactive").to.eq(true);
      });
  });

  it("UX-20: 'TRABAJO PAGADO PROM.' does not wrap a full sentence as its value", () => {
    cy.contains(".kpi", /trabajo pagado/i, { timeout: 10_000 })
      .find(".kpi__val")
      .invoke("text")
      .then((raw) => {
        const val = String(raw).trim();
        // RED today: the value slot holds the sentence "Aún no hay trabajos
        // pagados" (kpis.avgJob.none → .kpi__val, DashSections.tsx:130-132).
        // Desired: a compact value ("—" or "$N"); the explanation belongs in
        // the sub line.
        expect(val, "KPI value is not the empty-state sentence").to.not.match(
          /aún no hay/i,
        );
        expect(
          val.length,
          `KPI value slot ("${val}") is a compact value, not prose`,
        ).to.be.at.most(12);
      });
  });
});

describe("UX-20: 'Lo más alto del pipeline' empty shell explains itself", () => {
  it("UX-20: with zero open quotes the card shows empty-state copy", () => {
    loginEsFresh(EMPTY_PHONE);
    cy.visit("/quotes");
    cy.contains(".qside__card", "Lo más alto del pipeline", {
      timeout: 10_000,
    }).then(($card) => {
      const title = $card.find(".qside__title").text();
      const sub = $card.find(".qside__sub").text();
      const rest = $card.text().replace(title, "").replace(sub, "").trim();
      // RED today: QSideBig maps over an empty top4 — the card body is an
      // empty .qbig shell, nothing but the header (QuotesSections.tsx:232).
      expect(
        rest,
        "pipeline card carries copy beyond its header when empty",
      ).to.not.eq("");
    });
  });
});

describe("UX-21: desktop chrome — one nav system, labeled controls", () => {
  before(() => {
    loginEsFresh(CHROME_PHONE);
    // A real notification so the "● hace Xm" ticker pill renders (DashTopbar
    // polls /notifications; items start empty).
    seedAcceptedNotification(CHROME_PHONE, CHROME_CUSTOMER_PHONE);
  });

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(CHROME_PHONE);
    cy.apiUpdateUser({ language: "es" });
    cy.clearCookie("pm_lang");
    cy.viewport(1440, 900);
    cy.visit("/dashboard");
  });

  it("UX-21: at 1440×900 the topbar hamburger renders as the single sidebar toggle", () => {
    cy.get(".sb", { timeout: 10_000 }).should("be.visible");
    // The rail's own toggle was removed as redundant, so the topbar
    // hamburger must stay visible on desktop — it is the only control
    // that collapses/expands the rail (roadmap p.2/p.4).
    cy.get("button.topbar__menu").should("be.visible");
  });

  it("UX-21: [CONTRACT-PIN — green] the icon-only sidebar toggle keeps its accessible name", () => {
    // HONESTY: the rail's own .sb__toggle was removed as redundant — the
    // topbar hamburger (.topbar__menu, dashTopbar.toggleSidebar in both
    // dicts) is now the single toggle. This pin freezes ITS accessible
    // name so a rework cannot strip it.
    cy.get("button.topbar__menu", { timeout: 10_000 })
      .invoke("attr", "aria-label")
      .then((label) => {
        expect(String(label ?? "").trim().length, "topbar__menu aria-label").to
          .be.greaterThan(0);
      });
  });

  it("UX-21: the '● hace Xm' ticker pill has a visible tooltip (title)", () => {
    // The pill renders once the notification poll lands (10s interval).
    cy.get("a.topbar__ticker", { timeout: 20_000 })
      .should("be.visible")
      .invoke("attr", "title")
      .then((title) => {
        // RED today: the pill has an aria-label (DashTopbar.tsx:166) but no
        // title — a sighted user hovering "● hace 4m" gets no explanation.
        expect(
          String(title ?? "").trim().length,
          "ticker pill title tooltip",
        ).to.be.greaterThan(0);
      });
  });

  it("UX-21: the warranty checklist chip label is capitalized like its siblings", () => {
    // Pinned at the source dictionary — the chip renders this value verbatim
    // ("garantía: 6 meses" beside "Cliente"/"Pago"/"Inicio"). Cypress project
    // root is cypress/, so the repo dict is one level up.
    cy.readFile("../lang/es.json").then(
      (dict: Record<string, string>) => {
        const warranty = dict["termsWizard.warranty.label"] ?? "";
        const siblings = [
          dict["termsWizard.customer.label"] ?? "",
          dict["termsWizard.paymentTerms.label"] ?? "",
          dict["termsWizard.startDate.label"] ?? "",
        ];
        for (const s of siblings) {
          expect(s.charAt(0), `sibling label "${s}" starts uppercase`).to.match(
            /[A-ZÁÉÍÓÚÑ]/,
          );
        }
        // Regression pin: the warranty label must stay capitalized like its
        // siblings.
        expect(
          warranty.charAt(0),
          `warranty label "${warranty}" starts uppercase like its siblings`,
        ).to.match(/[A-ZÁÉÍÓÚÑ]/);
      },
    );
  });
});

// Module scope: keeps top-level declarations out of the shared global
// script scope the spec files otherwise compile into.
export {};
