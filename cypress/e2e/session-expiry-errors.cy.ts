/// <reference types="cypress" />

/**
 * P-35 [PLATFORM] "Auth/not-found errors serialize as HTTP 500." — islands
 *   can't distinguish "logged out" from "server broke"
 *   (backend/src/users/domain/coordinators/require-user/mod.ts:6-11 →
 *   UnauthorizedError reaches the wire as 500), so an expired session
 *   mid-action shows a generic error ("Couldn't apply discount." —
 *   invoicesPage.adjust.errDiscountApply, InvoicesPage.tsx:1643-1645)
 *   instead of a login redirect / clear session-expired UX.
 * P-67 [POLISH] "Transient console noise around login/logout transitions
 *   (one 502 on /api/admin/whoami, ERR_CONNECTION_REFUSED on two polls)."
 *   Desired: transitions produce no failed requests and no console errors.
 *
 * Grounded copy: the login page renders loginPage.heading "Welcome back" /
 * loginPage.subtitle "Sign in with your phone number." (lang/en.json:1461-
 * 1463; route front-end/routes/login.tsx). The sidebar logout affordance is
 * button.nav-item--logout (DashSidebar.tsx:396-407, label nav.logout
 * "Log out") → POST /api/auth/logout then location.href = "/".
 * /api/admin/whoami is polled by ImpersonationBanner.tsx on mount.
 */

describe("P-35 expired session mid-action → login redirect or session-expired UX", () => {
  const PHONE = "+15125552420";

  it("P-35 an island action after the session vanishes redirects to login (or shows session-expired copy), never a generic error", () => {
    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en" }); // fresh users default to es; EN copy asserted

    const clientName = `Expiry Edna ${Date.now()}`;
    cy.apiCreateCustomer({
      name: clientName,
      email: "edna.expiry@blackhole.postmarkapp.com",
    }).then((customerId: string) => {
      cy.apiCreateInvoice({
        customerId,
        jobName: "Session Expiry Job",
        amount: 35000,
        dueDate: "2099-01-01",
        status: "sent",
      }).then((invoiceId: string) => {
        cy.visit(`/invoices?open=${invoiceId}`);
        cy.get("[data-cy=invoice-detail]", { timeout: 10_000 }).should(
          "be.visible",
        );

        // Session expires mid-page — NO navigation. (pm_lang re-pinned so a
        // post-fix redirect still renders EN copy.)
        cy.clearCookies();
        cy.setCookie("pm_lang", "en");

        // Trigger an island fetch: apply a discount (POST /invoices/:id/discount).
        cy.get("[data-cy=invoice-discount-btn]").scrollIntoView().click();
        cy.focused().type("50");
        cy.contains("button", /apply|save/i).scrollIntoView().click();

        // DESIRED: the app recognizes the 401 and reacts with a login
        // redirect OR an explicit session-expired message. Today the fetch
        // comes back 500, the island can't tell "logged out" from "server
        // broke", and only the generic error shows → RED.
        cy.window({ timeout: 10_000 }).should((win) => {
          const onLoginRoute = /\/login/.test(win.location.pathname);
          const text = win.document.body.innerText ?? "";
          const sessionExpiredUx =
            /session[^.]{0,30}expired|expired[^.]{0,30}session|log in again|sign in|welcome back|inicia sesi[oó]n|sesi[oó]n[^.]{0,20}(expir|caduc)/i
              .test(text);
          expect(
            onLoginRoute || sessionExpiredUx,
            `login redirect or session-expired copy (at ${win.location.pathname})`,
          ).to.eq(true);
        });

        // The generic failure copy is exactly what must NOT be the outcome.
        cy.contains("Couldn't apply discount.").should("not.exist");
      });
    });
  });
});

describe("P-67 login/logout transitions are clean: no failed /api requests, no console errors", () => {
  const PHONE = "+15125552421";

  it("P-67 a login → logout → login cycle across / and /dashboard produces zero 5xx responses and zero console errors", () => {
    const consoleErrors: string[] = [];
    const serverErrors: string[] = [];

    // Collect app-level uncaught errors instead of hard-failing mid-cycle so
    // the final assertion reports EVERYTHING that leaked.
    cy.on("uncaught:exception", (err) => {
      consoleErrors.push(`uncaught: ${err.message}`);
      return false;
    });
    cy.on("window:before:load", (win) => {
      const orig = win.console.error.bind(win.console);
      // deno-lint-ignore no-explicit-any
      (win.console as any).error = (...args: unknown[]) => {
        consoleErrors.push(args.map((a) => String(a)).join(" "));
        orig(...(args as []));
      };
      win.addEventListener("unhandledrejection", (ev) => {
        consoleErrors.push(
          `unhandledrejection: ${String((ev as PromiseRejectionEvent).reason)}`,
        );
      });
    });
    // Record every /api response that comes back as a server error (the
    // live-proven offender: a transient 502 on /api/admin/whoami).
    cy.intercept({ url: "**/api/**" }, (req) => {
      req.on("response", (res) => {
        if (res.statusCode >= 500) {
          serverErrors.push(`${res.statusCode} ${req.method} ${req.url}`);
        }
      });
    });

    cy.clearCookies();
    cy.setCookie("pm_lang", "en");
    cy.loginAs(PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    cy.apiUpdateUser({ language: "en" });

    // Login transition → landing + dashboard.
    cy.visit("/");
    cy.visit("/dashboard");
    cy.get("button.nav-item--logout", { timeout: 10_000 }).should("exist");
    cy.wait(2000); // bounded settle window so mount-time polls fire

    // Logout transition (the UI path: POST /api/auth/logout then href "/").
    cy.get("button.nav-item--logout").click({ force: true });
    cy.location("pathname", { timeout: 10_000 }).should("eq", "/");
    cy.wait(2000); // window where the 502 / refused polls were observed

    // Log back in and return to the dashboard.
    cy.loginAs(PHONE);
    cy.visit("/dashboard");
    cy.get("button.nav-item--logout", { timeout: 10_000 }).should("exist");
    cy.wait(2000);

    cy.then(() => {
      expect(
        serverErrors,
        `5xx /api responses during login/logout transitions:\n${
          serverErrors.join("\n")
        }`,
      ).to.have.length(0);
      expect(
        consoleErrors,
        `console errors during login/logout transitions:\n${
          consoleErrors.join("\n")
        }`,
      ).to.have.length(0);
    });
  });
});
