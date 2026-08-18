/// <reference types="cypress" />

/**
 * Public-surface polish for paid (ad) traffic — all RED by design:
 *
 * P-58 "[PUBLIC] /q layout at 390px: 56px horizontal overflow (contractor
 *       email cut at x=446/390 in the footer); qty/amount columns touch —
 *       renders '32$1,120.00'."
 * P-62 "[POLISH] No @media print on /c — printed contracts get raw screen
 *       CSS." Desired: print styles that at minimum hide the interactive
 *       chrome (today's @media print block only hides .ctr__no-print — the
 *       brand strip — while the signature pad, its Undo/Clear buttons, the
 *       name input and the submit button all still print).
 * P-56 "[ADS] Unstyled plaintext 404." Desired: branded 404 with a working
 *       back-home link.
 * P-57 "[ADS] No theme-color, no manifest." Desired: theme-color meta +
 *       linked manifest in the document head.
 */
describe("public surface plumbing (mobile layout, print, 404, PWA)", () => {
  const PHONE = "+15125552630";
  // Realistically long contractor e-mail — the class of value the audit saw
  // cut at x=446 on a 390px viewport.
  const LONG_EMAIL = "hans.pedersen.construction@blackhole.postmarkapp.com";
  // Long descriptions force the qty/amount columns down to min-content
  // width at 390px, reproducing the audit's touching columns; 32 × $35.00
  // is the audit's exact "32$1,120.00" cell.
  const LINE_ITEMS = [
    {
      description: "Remove and haul away the old fence boards and posts",
      quantity: 32,
      unit: "ea",
      price: 3_500,
    },
    {
      description: "Install new cedar pickets along the property line",
      quantity: 1,
      unit: "job",
      price: 24_000,
    },
  ];

  describe("P-58 /q at a 390px phone viewport", () => {
    beforeEach(() => {
      cy.clearCookies();
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.apiUpdateUser({
        name: "Hans Pedersen",
        email: LONG_EMAIL,
        language: "en",
      });
      cy.viewport(390, 844);
    });

    function seedAndOpenQuote(): void {
      cy
        .seedQuoteToCash({
          quote: {
            summary: "Fence repair",
            jobName: "Fence Repair",
            lineItems: LINE_ITEMS,
            estimatedTotal: 136_000,
          },
        })
        .then(({ quoteId }) => {
          cy.clearCookies();
          cy.setCookie("pm_lang", "en");
          cy.visit(`/q/${quoteId}`);
          cy.wait(500); // islands hydrate/layout
        });
    }

    it("P-58 no horizontal overflow and the footer email stays fully inside the viewport", () => {
      seedAndOpenQuote();
      // The contractor email in the contact footer must be fully visible —
      // the audit measured it cut at x=446 on a 390px screen.
      cy.contains("a", LONG_EMAIL)
        .should("be.visible")
        .then(($a) => {
          const rect = $a[0].getBoundingClientRect();
          expect(
            rect.right,
            `footer email right edge ${
              Math.round(rect.right)
            }px must fit in the 390px viewport`,
          ).to.be.at.most(390);
          expect(rect.left, "footer email left edge").to.be.at.least(0);
        });
      // And the page as a whole must not scroll (or clip) sideways.
      cy.window().then((win) => {
        const scroller = win.document.scrollingElement!;
        expect(
          scroller.scrollWidth,
          `scrollWidth ${scroller.scrollWidth} must not exceed the ${win.innerWidth}px viewport`,
        ).to.be.at.most(win.innerWidth);
      });
    });

    it("P-58 qty and amount columns keep a visible separation (never '32$1,120.00')", () => {
      seedAndOpenQuote();
      // Sanity: the audit's exact cells rendered.
      cy.get("table").first().as("lineItems");
      cy.get("@lineItems").contains("td", "32").should("exist");
      cy.get("@lineItems").contains("td", "$1,120.00").should("exist");
      // Measure the actual painted gap between the qty text and the amount
      // text in every row — a customer must never read "32$1,120.00".
      cy.get("@lineItems")
        .find("tbody tr")
        .each(($tr) => {
          const tds = $tr.find("td");
          if (tds.length < 3) return; // description-only rows
          const doc = tds[0].ownerDocument!;
          const rectOf = (el: Element) => {
            const range = doc.createRange();
            range.selectNodeContents(el);
            return range.getBoundingClientRect();
          };
          const qtyRect = rectOf(tds[1]);
          const amtRect = rectOf(tds[2]);
          const gap = amtRect.left - qtyRect.right;
          expect(
            gap,
            `gap between qty "${tds[1].textContent?.trim()}" and amount "${
              tds[2].textContent?.trim()
            }" (${Math.round(gap)}px)`,
          ).to.be.at.least(4);
        });
    });
  });

  describe("P-62 /c print styles", () => {
    beforeEach(() => {
      cy.clearCookies();
      cy.loginAs(PHONE);
      cy.request("POST", "/api/me/onboarded", { skipped: true });
      cy.apiUpdateUser({ language: "en" });
    });

    it("P-62 the contract page ships an @media print block that hides the interactive signing chrome", () => {
      cy.seedQuoteToCash().then(({ contractId }) => {
        cy.clearCookies();
        cy.setCookie("pm_lang", "en");
        cy.visit(`/c/${contractId}`);
        // Unsigned contract → the signature form (pad + inputs + submit)
        // renders after the island fetch.
        cy.get('button[type="submit"]', { timeout: 10_000 }).should("exist");

        cy.window().then((win) => {
          const doc = win.document;
          // Collect every selector hidden inside an @media print block.
          let printBlocks = 0;
          const hiddenSelectors: string[] = [];
          const walk = (rules: CSSRuleList) => {
            for (const rule of Array.from(rules)) {
              if (rule instanceof win.CSSMediaRule) {
                if (rule.media.mediaText.includes("print")) {
                  printBlocks++;
                  for (const inner of Array.from(rule.cssRules)) {
                    const sr = inner as CSSStyleRule;
                    if (sr.style && sr.style.display === "none") {
                      hiddenSelectors.push(sr.selectorText);
                    }
                  }
                } else if (rule.cssRules) {
                  walk(rule.cssRules);
                }
              }
            }
          };
          for (const sheet of Array.from(doc.styleSheets)) {
            try {
              walk(sheet.cssRules);
            } catch {
              /* cross-origin sheet — none expected on /c */
            }
          }
          expect(printBlocks, "at least one @media print block on /c").to.be
            .greaterThan(0);

          const coveredByPrintHide = (el: Element | null) =>
            !!el &&
            hiddenSelectors.some((sel) => {
              try {
                return !!el.closest(sel);
              } catch {
                return false;
              }
            });

          // The interactive signing chrome must not survive onto paper.
          const signButton = doc.querySelector('button[type="submit"]');
          const nameInput = doc.querySelector('form input[type="text"]');
          expect(signButton, "sign submit button").to.exist;
          expect(nameInput, "typed-name input").to.exist;
          expect(
            coveredByPrintHide(signButton),
            `sign button hidden when printing (print-hidden selectors today: ${
              JSON.stringify(hiddenSelectors)
            })`,
          ).to.eq(true);
          expect(
            coveredByPrintHide(nameInput),
            "typed-name input hidden when printing",
          ).to.eq(true);
        });
      });
    });
  });

  describe("P-56 + P-57 branded 404 and PWA chrome", () => {
    it("P-56 a mistyped URL lands on a branded 404 with a working way back home", () => {
      // Status contract first (already 404 today — the body is the problem).
      cy.request({ url: "/definitely-not-a-page-xyz", failOnStatusCode: false })
        .its("status")
        .should("eq", 404);
      // Today this cy.visit itself fails: the server answers content-type
      // text/plain ("Not Found"), which is exactly the P-56 defect — a paid
      // visitor gets a plaintext dump instead of an HTML page.
      cy.visit("/definitely-not-a-page-xyz", { failOnStatusCode: false });
      cy.contains(/paperwork monster/i, { timeout: 10_000 }).should(
        "be.visible",
      );
      cy.get('a[href="/"]').first().should("be.visible").click();
      cy.location("pathname").should("eq", "/");
    });

    it("P-57 the 404 page still carries the theme-color + manifest head chrome", () => {
      cy.visit("/definitely-not-a-page-xyz", { failOnStatusCode: false });
      cy.get('head meta[name="theme-color"]').should("exist");
      cy.get('head link[rel="manifest"]').should("exist");
    });

    it("P-57 pages ship a theme-color meta and a resolvable web app manifest", () => {
      cy.visit("/");
      cy.get('head meta[name="theme-color"]')
        .should("have.attr", "content")
        .and("match", /^(#|rgb|hsl)/);
      cy.get('head link[rel="manifest"]')
        .should("have.attr", "href")
        .then((href) => {
          cy.request(String(href)).then((res) => {
            expect(res.status).to.eq(200);
            const manifest = typeof res.body === "string"
              ? JSON.parse(res.body)
              : res.body;
            expect(manifest, "manifest JSON").to.have.property("name");
          });
        });
    });
  });
});
