/// <reference types="cypress" />

/**
 * RED (TDD) — UX-27 + UX-26(b): the skip-setup persona's placeholder name
 * must never be treated as a real identity.
 *
 * Findings (ux-problems.md, verbatim fragments):
 *  UX-27 "[SKIP-USER] The placeholder name is treated as a real name
 *         everywhere the user could fix it. Topbar greets 'Hola, Nuevo 👋'
 *         … and the SetupChecklist shows '✓ Tu nombre' as COMPLETE for
 *         'Nuevo usuario' — the one field this user most needs to supply is
 *         marked done"
 *  UX-26 (b) "the preview showed 'DE: Nuevo usuario' with no warning and NO
 *         edit affordance on the De-block (Para has pencils; De doesn't) —
 *         nothing invites the user to fix it"
 *
 * Persona: SKIP-SETUP — raw cy.request POST /api/auth/verify (master OTP;
 * the seeded placeholder "Nuevo usuario" survives — verify-otp/mod.ts:35)
 * plus the persona's OWN skip action (POST /api/me/onboarded
 * {skipped:true} — the audit's global "Omitir configuración"). NO name /
 * email / business seeding, NO cy.loginAs.
 *
 * Grounded selectors (file:line verified):
 *  - topbar greeting     .topbar__greet-name — DashTopbar.tsx:146-149 renders
 *                        dashTopbar.greeting "Hola, {name} 👋" with
 *                        greetingName = first word of user.name
 *                        (routes/dashboard/index.tsx:37-39 → "Nuevo").
 *                        Live-probed SSR: "Hola, Nuevo 👋".
 *  - setup checklist     SetupChecklist.tsx:50-56 — item key "name",
 *                        done: !!snap.user.name?.trim() ← counts the
 *                        placeholder as done; li = ✓-span + <a> label
 *                        (:144-166), label setupChecklist.item.name
 *                        ("Tu nombre" / "Your name").
 *  - assistant preview   AsstChat.tsx:5174-5211 — the FROM hero
 *                        (.quote-review__hero, label asstChat.preview.from)
 *                        renders {from.business || from.name} READ-ONLY
 *                        ("Read-only; the editable TO (customer) follows");
 *                        from.name = raw user.name
 *                        (routes/assistant/[threadId].tsx:148-153). The
 *                        customer block has the pencil (.quote-review__swap,
 *                        :5222-5246); the FROM block has NO interactive
 *                        element — that asymmetry is the (b) red.
 *  - dev seed            /assistant?dev → .chat__empty-debug-btn
 *                        (AsstChat.tsx:4569-4585, localhost-only) — same
 *                        deterministic wizard entry the P-21 spec uses.
 *  - customer form       .cust-create input.cust-pick__search (name),
 *                        input[type=tel], input[type=email],
 *                        .cust-create__btn--primary (AsstChat.tsx:7341-7411;
 *                        phone-only customers are allowed — hasContact).
 *
 * Phones used (reserved block +15125556200…6299):
 *   +15125556230 contractor (skip-setup), +15125556231 customer.
 */

// Namespaced (cypress specs share one script scope — plain PHONE consts
// collide across files at typecheck time).
const UX27_PHONE = "+15125556230";
const UX27_CUSTOMER_PHONE = "+15125556231";
/** The seeded placeholder ("Nuevo usuario"/"New user") and its first token
 *  ("Nuevo"/"New") — the strings that must never read as a real identity. */
const UX27_PLACEHOLDER_TOKEN = /\bNuevo\b|\bNew\b/i;

function ux27LoginSkipSetup() {
  cy.clearCookies();
  // Raw verify — no loginAs, no seeding: the placeholder identity survives.
  cy.request("POST", "/api/auth/verify", { phoneNumber: UX27_PHONE, code: "000000" });
  // The persona's own skip (the audit's global "Omitir configuración").
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  // Premise guard: this account must still be the placeholder user.
  cy.request("/api/me").its("body.name").should("match", /Nuevo usuario|New user/);
}

describe("UX-27: the placeholder name is not treated as a real name", () => {
  beforeEach(ux27LoginSkipSetup);

  it("UX-27: the topbar does not greet the user as 'Nuevo'", () => {
    cy.visit("/dashboard");
    // RED today (live-probed SSR): .topbar__greet-name = "Hola, Nuevo 👋".
    // Desired: a neutral greeting (e.g. "Hola 👋") until a real name exists.
    cy.get(".topbar__greet-name", { timeout: 10_000 })
      .should("be.visible")
      .invoke("text")
      .should((text) => {
        expect(text, "greeting must not use the placeholder first name")
          .not.to.match(UX27_PLACEHOLDER_TOKEN);
      });
  });

  it("UX-27: SetupChecklist does NOT mark 'Tu nombre' complete for the placeholder", () => {
    cy.visit("/dashboard");
    // SetupChecklist is a client island (fetches /profile) — wait for the
    // name item to render. Label per lang/{es,en}.json setupChecklist.item.name.
    cy.contains("a", /^(Tu nombre|Your name)$/, { timeout: 10_000 })
      .closest("li")
      .within(() => {
        // The done-state renders "✓" inside the leading status span
        // (SetupChecklist.tsx:149-156). RED today: done=true for
        // "Nuevo usuario" (:54 — !!snap.user.name?.trim()).
        cy.get("span")
          .first()
          .should(($el) => {
            expect(
              $el.text().trim(),
              "'Tu nombre' must stay INCOMPLETE while the name is the placeholder",
            ).not.to.contain("✓");
          });
      });
  });
});

describe("UX-26(b): the doc preview's De-block must not present the placeholder as a finished identity", () => {
  beforeEach(ux27LoginSkipSetup);

  it("UX-26: the FROM hero carries an edit affordance / warning when identity is placeholder", () => {
    // Deterministic path to the preview: dev seed → customer step
    // (phone-only, like the audited flow) → 4 remaining wizard steps.
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 }).should("be.visible").click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9-]+$/);

    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Pedro Cliente");
    cy.get(".cust-create input[type=tel]").type(UX27_CUSTOMER_PHONE);
    // No email — the audited customer was phone-only.
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();

    const pickFirstOption = () =>
      cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
        .filter(":visible")
        .first()
        .click();
    pickFirstOption(); // start_date
    pickFirstOption(); // wraps
    pickFirstOption(); // payment_terms
    pickFirstOption(); // warranty

    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");

    // Desired contract, both acceptable green shapes:
    //  (a) the De-block still shows the (placeholder) sender ⇒ it must carry
    //      an edit affordance and/or an explicit warning — today it is the
    //      ONLY inert hero (the customer hero has the pencil);
    //  (b) the preview refuses to present the placeholder as the sender at
    //      all (e.g. an "add your name" CTA replaces it).
    // RED today: shape (a) with ZERO interactive/warning elements.
    cy.get(".quote-review").then(($qr) => {
      const showsPlaceholder = /Nuevo usuario|New user/i.test($qr.text());
      if (showsPlaceholder) {
        cy.contains(".quote-review__hero", /Nuevo usuario|New user/i)
          .find("button, a, [role=button], [class*=warn], [class*=alert]")
          .should("exist");
      } else {
        // Placeholder suppressed — that IS the fix (it is no longer treated
        // as a real identity). Nothing more to require here.
        expect(showsPlaceholder).to.equal(false);
      }
    });
  });
});
