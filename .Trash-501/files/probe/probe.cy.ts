/// <reference types="cypress" />
// TEMPORARY diagnostic probe (agent scratch). Deleted after use.
const PHONE = "+15125552410";
const OUT =
  "/tmp/claude-501/-Users-raphaelcastro-Documents-programming-v2/d1046a0e-327a-4446-b873-e648efb65923/scratchpad/agentA-inv/probe-out.json";

function describeAt(doc: Document, win: Window, x: number, y: number) {
  const at = doc.elementFromPoint(x, y) as HTMLElement | null;
  const chain: string[] = [];
  let n: HTMLElement | null = at;
  while (n) {
    const cs = win.getComputedStyle(n);
    chain.push(`<${n.tagName.toLowerCase()} class="${n.className}"> pos=${cs.position} z=${cs.zIndex}`);
    n = n.parentElement;
  }
  return { at: at ? at.outerHTML.slice(0, 200) : null, chain };
}

it("probe: what covers the scheduled CTA", () => {
  cy.clearCookies();
  cy.setCookie("pm_lang", "en");
  cy.loginAs(PHONE);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "en" });
  const clientName = `Probe Nora ${Date.now()}`;
  cy.apiCreateCustomer({ name: clientName }).then((customerId: string) => {
    cy.apiCreateInvoice({
      customerId,
      jobName: "Probe Job",
      amount: 12300,
      dueDate: "2099-01-01",
      status: "scheduled",
      scheduledFor: "2099-01-01",
    }).then(() => {
      cy.visit("/invoices");
      cy.contains(".qcard", clientName, { timeout: 20_000 })
        .scrollIntoView()
        .find("[data-cy=invoice-cta-scheduled]")
        .then(($btn) => {
          const el = $btn[0] as HTMLElement;
          const doc = el.ownerDocument;
          const win = doc.defaultView!;
          const report: Record<string, unknown> = {};

          const r0 = el.getBoundingClientRect();
          report.afterCyScrollIntoView = {
            rect: { top: r0.top, left: r0.left, w: r0.width, h: r0.height },
            ...describeAt(doc, win, r0.left + r0.width / 2, r0.top + r0.height / 2),
          };

          // Simulate Cypress scrollBehavior:'top' — element top at VIEWPORT top.
          const content = doc.querySelector(".content") as HTMLElement;
          const before = content.scrollTop;
          content.scrollTop = before + el.getBoundingClientRect().top;
          const r1 = el.getBoundingClientRect();
          report.afterViewportTopScroll = {
            contentScrollTop: content.scrollTop,
            rect: { top: r1.top, left: r1.left, w: r1.width, h: r1.height },
            ...describeAt(doc, win, r1.left + r1.width / 2, r1.top + r1.height / 2),
          };
          report.topbar = (() => {
            const tb = doc.querySelector(".topbar") as HTMLElement | null;
            if (!tb) return null;
            const tr = tb.getBoundingClientRect();
            return { top: tr.top, height: tr.height, pos: win.getComputedStyle(tb).position };
          })();
          const contentRect = content.getBoundingClientRect();
          report.content = { top: contentRect.top, height: contentRect.height };
          cy.writeFile(OUT, report);
        });
    });
  });
});
