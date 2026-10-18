/// <reference types="cypress" />

/**
 * REQ-045 — Assistant view: the conversation list scrolls in its own
 * column; the chat input never leaves the fold.
 *
 * Raphael: "in the assistant view, the overflow for the different chat needs
 * to be scroll. the problem is that i get many conversations going and it
 * pushes the chat input below the fold."
 *
 * The bug: the assistant shell (`.app`) had no viewport height on desktop,
 * so `.main` → `.asst` → `.threads` all grew to the conversation list's
 * content height, the chat column stretched with it, and the composer ended
 * up thousands of pixels below the fold. 40 seeded conversations is enough
 * to overflow any of the viewports below several times over.
 */
describe("assistant — conversation list overflow (REQ-045)", () => {
  const CONTRACTOR_PHONE = "+15125550111";
  const SEED = 40;

  function seedConversations() {
    cy.request("/api/agents/conversations?limit=50").then(({ body }) => {
      const have = Array.isArray(body) ? body.length : 0;
      for (let i = have; i < SEED; i++) {
        cy.request("POST", "/api/agents/conversations", {});
      }
    });
  }

  function assertShellFitsViewport() {
    // The page itself must not scroll: the shell is pinned to the viewport.
    cy.window().then((win) => {
      const doc = win.document.documentElement;
      expect(doc.scrollHeight, "document scrollHeight").to.be.at.most(
        win.innerHeight,
      );
    });
    // The composer's send button is fully inside the viewport, unscrolled.
    cy.get("button.composer__send").should(($btn) => {
      const r = $btn[0].getBoundingClientRect();
      expect(r.top, "send button top").to.be.at.least(0);
      expect(r.bottom, "send button bottom").to.be.at.most(
        Cypress.config("viewportHeight"),
      );
    });
  }

  function assertListScrolls() {
    cy.get(".threads__list").should(($list) => {
      const el = $list[0];
      expect(el.scrollHeight, "list scrollHeight").to.be.greaterThan(
        el.clientHeight,
      );
      expect(
        getComputedStyle(el).overflowY,
        "list overflow-y",
      ).to.match(/auto|scroll/);
    });
    cy.get(".threads__list").then(($list) => {
      $list[0].scrollTo({ top: 400 });
    });
    cy.get(".threads__list").should(($list) => {
      expect($list[0].scrollTop, "list scrollTop after scrollTo").to.be
        .greaterThan(0);
    });
  }

  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs(CONTRACTOR_PHONE);
    cy.request("PUT", "/api/me", { language: "en" });
    seedConversations();
  });

  it("REQ-045 the conversation list scrolls inside its own column instead of growing the page", () => {
    cy.viewport(1440, 900);
    cy.visit("/assistant");
    cy.get(".thread").should("have.length.at.least", SEED);
    assertListScrolls();
    assertShellFitsViewport();
  });

  it("REQ-045 with many conversations the chat input stays above the fold", () => {
    cy.viewport(1440, 900);
    cy.visit("/assistant");
    cy.get(".thread").should("have.length.at.least", SEED);
    assertShellFitsViewport();
    // A short laptop window: the old 720px floor on the grid would clip the
    // composer under the shell's overflow:hidden instead of letting the two
    // inner scrollers absorb the height.
    cy.viewport(1280, 720);
    assertShellFitsViewport();
    assertListScrolls();
  });

  it("REQ-045 the same holds on an open thread page", () => {
    cy.viewport(1440, 900);
    cy.request("/api/agents/conversations?limit=1").then(({ body }) => {
      cy.visit(`/assistant/${body[0].id}`);
    });
    cy.get(".thread").should("have.length.at.least", SEED);
    assertListScrolls();
    assertShellFitsViewport();
  });
});
