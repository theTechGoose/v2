/// <reference types="cypress" />

/**
 * Pricing & offerings — Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (Aug 31, 2026), which supersedes PDF p20:
 *
 *   Monster Free  $0/month   max 5 quotes/month, unlimited invoices
 *   Monster       $99/month  full self-service platform
 *
 * Every Monster Assist tier ($199, $399–$599) is an onboarding/phone upsell
 * and never appears on a page. No percentage fee. Both landing pages render
 * the same two cards from shared/quote-flow/pricing-plans.ts.
 */
for (const page of ["/", "/landing"] as const) {
  describe(`${page} — pricing section`, () => {
    beforeEach(() => {
      cy.clearCookies();
      cy.setCookie("pm_lang", "en"); // re-pin EN after the wipe (Spanish-first app)
      cy.visit(page);
      cy.get("#pricing", { timeout: 10_000 }).scrollIntoView().should(
        "be.visible",
      );
    });

    const pricing = () => cy.get("#pricing");

    it("shows exactly the two public plans — Monster Free, then Monster", () => {
      pricing().within(() => {
        cy.get("[data-cy=pricing-plan]").filter(":visible").should(
          "have.length",
          2,
        );
        cy.get("[data-cy=pricing-plan-name]").then(($names) => {
          const names = [...$names].map((el) => (el.textContent ?? "").trim());
          expect(names).to.deep.equal(["Monster Free", "Monster"]);
        });
      });
    });

    it("Monster Free is $0 a month with 5 quotes and unlimited invoices", () => {
      pricing().within(() => {
        cy.get("[data-cy=pricing-plan]").first().within(() => {
          cy.contains(/\$0\b/).should("be.visible");
          cy.contains(/5 quotes/i).should("be.visible");
          cy.contains(/unlimited invoices/i).should("be.visible");
        });
      });
    });

    it("Monster is $99 a month", () => {
      pricing().within(() => {
        cy.get("[data-cy=pricing-plan]").last().within(() => {
          cy.contains(/\$99\b/).should("be.visible");
        });
      });
    });

    it("hides every Monster Assist tier and its prices", () => {
      pricing().within(() => {
        // \bassist\b: "The PM Assistant" is a Free feature and must not trip this.
        cy.contains(/\bassist\b/i).should("not.exist");
        cy.contains(/\$(199|399|599)\b/).should("not.exist");
      });
      cy.get("body").invoke("text").should("not.match", /monster assist/i);
    });

    it("no longer sells the retired $15 Starter / Pro / Crew tiers", () => {
      pricing().within(() => {
        cy.contains(/\$15\b/).should("not.exist");
        cy.contains(/\bstarter\b|\bcrew\b/i).should("not.exist");
      });
    });

    it("shows no percentage fee anywhere in the plans", () => {
      pricing().within(() => {
        cy.contains(/\d+\s?%/).should("not.exist");
      });
    });
  });
}
