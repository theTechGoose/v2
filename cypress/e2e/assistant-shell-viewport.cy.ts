/// <reference types="cypress" />

/**
 * REQ-052 — "everything needs to extend to 100% viewport": the assistant
 * shell (sidebar, conversations, chat, footer) is exactly the browser window,
 * on a tall window and on a short one.
 */
describe("REQ-052 /assistant shell fills the viewport", () => {
  beforeEach(() => {
    cy.clearCookies();
    cy.loginAs("+15125550992");
  });

  for (const height of [1000, 760]) {
    it(`REQ-052 at 1440×${height} the shell ends exactly at the window's bottom and the footer is inside it`, () => {
      cy.viewport(1440, height);
      cy.visit("/assistant");
      cy.get(".asst", { timeout: 15_000 }).should("be.visible");
      cy.window().should((win) => {
        const app = win.document.querySelector(".app")!.getBoundingClientRect();
        const footer = win.document.querySelector(".site-footer, footer")!
          .getBoundingClientRect();
        expect(Math.round(app.bottom), "shell bottom").to.eq(height);
        expect(Math.round(footer.bottom), "footer inside the window").to.be.lte(
          height,
        );
      });
    });
  }
});
