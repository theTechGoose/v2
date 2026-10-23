/// <reference types="cypress" />

/**
 * Pricing & offerings — Hans's "PM – Meeting Recap & Action Items
 * August 27-28, 2026" email (Aug 31, 2026) plus his Sep 2 correction, REQ-118
 * (Raphael, 2026-10-22: "add another tier called monster assist + 399") and
 * REQ-119 (Raphael, 2026-10-23: "the monster assist + is a hidden item that can
 * only be shown in the settings upgrade panel not on the onboarding panel."):
 *
 *   Monster Free      $0/month   "Unlimited invoices" (leads), max 5 quotes/month
 *   Monster           $99/month  full self-service platform
 *   Monster Assist    $199/month platform + phone/text/email help
 *   Monster Assist+   $399/month higher-level expert assistance — HIDDEN, settings only
 *   Monster Projects  Custom     scoped per customer — no figure on the site
 *
 * The $1 test tier (REQ-064) and Monster Assist+ (REQ-119) never appear on a page.
 * No percentage fee. Both landing pages render the same four cards from
 * shared/quote-flow/pricing-plans.ts.
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
    const plan = (n: number) => cy.get("#pricing [data-cy=pricing-plan]").eq(n);

    it("shows exactly the four public plans, in order", () => {
      pricing().within(() => {
        cy.get("[data-cy=pricing-plan]").filter(":visible").should(
          "have.length",
          4,
        );
        cy.get("[data-cy=pricing-plan-name]").then(($names) => {
          const names = [...$names].map((el) => (el.textContent ?? "").trim());
          expect(names).to.deep.equal([
            "Monster Free",
            "Monster",
            "Monster Assist",
            "Monster Projects",
          ]);
        });
      });
    });

    it("Monster Free is $0 a month and leads with Unlimited invoices; max 5 quotes", () => {
      plan(0).within(() => {
        cy.contains(/\$0\b/).should("be.visible");
        cy.get("li").first().invoke("text").should(
          "match",
          /unlimited invoices/i,
        );
        cy.contains(/5 quotes/i).should("be.visible");
      });
    });

    it("Monster is $99 a month", () => {
      plan(1).within(() => {
        cy.contains(/\$99\b/).should("be.visible");
      });
    });

    it("Monster Assist is $199 a month and on the site", () => {
      plan(2).within(() => {
        cy.contains(/\$199\b/).should("be.visible");
        cy.contains(/phone, text & email/i).should("be.visible");
      });
    });

    it("REQ-119 Monster Assist+ is hidden from the site — no card, no $399", () => {
      pricing().within(() => {
        cy.contains(/monster assist\+/i).should("not.exist");
        cy.contains(/\$399\b/).should("not.exist");
      });
      cy.get("body").invoke("text").should("not.match", /monster assist\+/i);
    });

    it("Monster Projects is the custom card — no dollar figure, a talk-to-us CTA", () => {
      plan(3).within(() => {
        cy.contains(/custom/i).should("be.visible");
        cy.contains(/\$\s?\d/).should("not.exist");
        cy.contains("a", /talk to us/i).should("be.visible");
      });
    });

    it("hides the $1 test tier and the old $599 top of the range", () => {
      pricing().within(() => {
        cy.contains(/monster test/i).should("not.exist");
        cy.contains(/\$(1|599)\b/).should("not.exist");
      });
      cy.get("body").invoke("text").should("not.match", /monster test/i);
    });

    it("no longer sells the retired $15 Starter / Pro / Crew tiers", () => {
      pricing().within(() => {
        cy.contains(/\$15\b/).should("not.exist");
        cy.contains(/\bstarter\b|\bcrew\b/i).should("not.exist");
      });
    });

    it("shows no percentage fee or Projects dollar range anywhere in the plans", () => {
      pricing().within(() => {
        cy.contains(/\d+\s?%/).should("not.exist");
        cy.contains(/\$\s?(600|2,?000)\b/).should("not.exist");
      });
    });
  });
}
