/// <reference types="cypress" />

/**
 * PDF p8 + p9 — navigation chrome:
 *   p8: "The 'My Assistant' needs to be on the dashboard at the top because
 *        on mobile you have to hit the hamburger button to actually see
 *        that — and 'My Assistant' is everything."
 *   p8: "PM Assistant — the hamburger menu icon does not work." (bug)
 *   p9: QuickBooks-style minimize: a collapse arrow shrinks the sidebar to a
 *       hamburger rail; the same pattern applies to the PM Assistant
 *       conversations panel.
 *
 * Contract selectors: [data-cy=assistant-cta], [data-cy=sidebar-collapse],
 * [data-cy=sidebar-expand], [data-cy=asst-threads-collapse].
 */
describe("My Assistant access on mobile dashboard (p8)", () => {
  const PHONE = "+15125550933";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.viewport(390, 844); // iPhone-class
  });

  it("shows a My Assistant entry at the TOP of the dashboard without opening the hamburger", () => {
    cy.visit("/dashboard");
    cy.get("[data-cy=assistant-cta]", { timeout: 10_000 })
      .should("be.visible");
    // It must sit in the top region of the viewport, not below the fold.
    cy.get("[data-cy=assistant-cta]").then(($el) => {
      expect($el[0].getBoundingClientRect().top).to.be.lessThan(400);
    });
  });

  it("tapping it lands on the assistant", () => {
    cy.visit("/dashboard");
    cy.get("[data-cy=assistant-cta]").click();
    cy.location("pathname").should("match", /^\/assistant/);
  });
});

describe("PM Assistant hamburger works on mobile (p8 bug)", () => {
  const PHONE = "+15125550934";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.viewport(390, 844);
    cy.visit("/assistant");
  });

  it("the hamburger icon opens the navigation menu", () => {
    // The mobile menu toggle must exist and actually reveal the nav.
    cy.get("[data-cy=mobile-menu], button[aria-label*=menu i], .hamburger, [class*=hamburger]")
      .filter(":visible")
      .first()
      .click();
    cy.contains("a", /dashboard/i).should("be.visible");
  });

  it("the opened menu can be closed again", () => {
    cy.get("[data-cy=mobile-menu], button[aria-label*=menu i], .hamburger, [class*=hamburger]")
      .filter(":visible")
      .first()
      .click();
    cy.contains("a", /dashboard/i).should("be.visible");
    // Close via the drawer's designed affordance (backdrop overlay).
    cy.get(".sb-backdrop").click({ force: true });
    cy.contains("a", /dashboard/i).should("not.be.visible");
  });
});

describe("QuickBooks-style sidebar minimize (p9)", () => {
  const PHONE = "+15125550935";

  beforeEach(() => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
    cy.loginAs(PHONE);
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted
    cy.request("POST", "/api/me/onboarded", { skipped: true }); // skip the /welcome trap for fresh users
    cy.viewport(1440, 900);
    cy.visit("/dashboard");
  });

  /** Label may be hidden OR removed entirely (icon-rail) — both count as collapsed. */
  function assertNavLabelGone(label: RegExp) {
    cy.get("body").then(($body) => {
      const el = $body.find("a").filter((_, a) => label.test(a.textContent ?? ""));
      const visible = el.filter(":visible");
      expect(visible.length, `nav label ${label} hidden or removed`).to.eq(0);
    });
  }

  it("a collapse arrow minimizes the sidebar to a slim rail", () => {
    cy.get("[data-cy=sidebar-collapse]", { timeout: 10_000 }).click();
    // Nav labels disappear; the rail (with a hamburger/expand control) remains.
    cy.get("[data-cy=sidebar-expand]").should("be.visible");
    assertNavLabelGone(/customers/i);
  });

  it("the hamburger on the collapsed rail restores the full sidebar", () => {
    cy.get("[data-cy=sidebar-collapse]").click();
    cy.get("[data-cy=sidebar-expand]").click();
    cy.contains("a", /customers/i).should("be.visible");
  });

  it("the collapsed state survives navigation (added spec beyond p9 — sanity of the pattern)", () => {
    cy.get("[data-cy=sidebar-collapse]").click();
    cy.visit("/quotes");
    cy.get("[data-cy=sidebar-expand]").should("be.visible");
    assertNavLabelGone(/customers/i);
  });

  it("the PM Assistant conversations panel collapses and expands with the same pattern", () => {
    cy.visit("/assistant");
    // Measure via the DOM directly — the island re-renders while its list
    // loads, so element subjects detach; widths are read fresh each check.
    const panelWidth = (win: Window) => {
      const panel = win.document.querySelector(".threads, [data-cy=asst-threads]") as HTMLElement | null;
      return panel ? panel.getBoundingClientRect().width : 0;
    };
    cy.get("[data-cy=asst-threads-collapse]", { timeout: 10_000 }).should("be.visible");
    cy.window().then((win) => {
      const before = panelWidth(win);
      expect(before, "panel starts expanded").to.be.greaterThan(100);
      cy.get("[data-cy=asst-threads-collapse]").click();
      cy.window().should((w2) => {
        expect(panelWidth(w2), "threads panel minimized").to.be.lessThan(before / 2);
      });
      // The chat itself survives, and an expand control restores the panel.
      cy.get("textarea.composer__input, .chat__head").should("be.visible");
      cy.get("[data-cy=asst-threads-expand]", { timeout: 10_000 }).click();
      cy.window().should((w3) => {
        expect(panelWidth(w3), "threads panel restored").to.be.gte(before - 5);
      });
    });
  });
});
