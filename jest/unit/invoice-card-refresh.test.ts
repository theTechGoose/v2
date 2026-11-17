/**
 * REQ-554 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issues M9, m23, m43, m52. RCA
 * CONFIRMED / UPHELD at ad104a19:
 *
 * - M9: "Enviar ahora" with the email delivered and the text failed only set
 *   the card's partial note — no re-read — so the invoice the server had
 *   already stamped "sent" stayed "PROGRAMADA" in 04 Próximas until a reload.
 *   A change order approved on /co never announced itself, so the owner's
 *   /invoices and /quotes waited for the topbar's next notifications tick.
 * - m23: the sidebar's Invoices badge (dash cache, stats.invoices.pending)
 *   kept its count after the invoice was paid — nothing on /invoices or
 *   /payments called refreshDash.
 * - m43: "Listo, lo recibí" (and "Didn't get it") reloaded the whole page.
 * - m52: the half-delivered send rendered in the failure red; and "Send now"
 *   kept the due date the schedule computed (Due Dec 19 for a Nov 12 send).
 *
 * These are wiring checks on the island sources (the pure rules live in
 * front-end/lib/invoice-card.ts, tested with deno test); the behaviour is
 * proven in the browser by e2e/invoice-card-refresh.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** the body of `async function <name>(` … up to the next sibling function */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`(async )?function ${name}\\(`));
  expect(at).toBeGreaterThan(-1);
  const next = src.slice(at + 10).search(
    /\n {2}(async )?function \w+\(|\n {2}const \[|\n {2}useEffect\(|\n {2}return \(/,
  );
  return src.slice(at, next > -1 ? at + 10 + next : at + 3000);
}

describe("REQ-554 /invoices cards re-read in place (M9, m23, m43, m52)", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");

  test("REQ-554 every InvoiceCard is handed the page's refreshInvoices", () => {
    const cards = src.match(/<InvoiceCard\b/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    const wired = src.match(/<InvoiceCard\b[^>]*?onRefresh=\{refreshInvoices\}/gs) ??
      [];
    expect(wired.length).toBe(cards.length);
  });

  test("REQ-554 m23 refreshInvoices also refreshes the dash cache the sidebar badge reads", () => {
    expect(src).toMatch(
      /import \{[^}]*\brefreshDash\b[^}]*\} from "\.\.\/lib\/dash-cache\.ts"/,
    );
    expect(fnBody(src, "refreshInvoices")).toMatch(/refreshDash\(\)/);
  });

  test("REQ-554 m43 'Payment confirmed' / 'Didn't get it' re-read in place — no page reload — and say what happened", () => {
    for (const fn of ["doConfirmReceived", "doRejectClaim"]) {
      const body = fnBody(src, fn);
      expect(body).not.toMatch(/location\.reload\(/);
      expect(body).toMatch(/onRefresh\(/);
      expect(body).toMatch(/onFlash\(/);
    }
    expect(fnBody(src, "doConfirmReceived")).toMatch(
      /invoicesPage\.flash\.paymentConfirmed/,
    );
    expect(fnBody(src, "doRejectClaim")).toMatch(
      /invoicesPage\.flash\.claimReopened/,
    );
  });

  test("REQ-554 M9 Send now re-reads after EVERY outcome — full, partial and failed — and never reloads", () => {
    const body = fnBody(src, "doSendNow");
    expect(body).not.toMatch(/location\.reload\(/);
    // the re-read sits in the finally, so no branch can skip it
    expect(body).toMatch(/finally \{[^}]*onRefresh\(/s);
  });

  test("REQ-554 m52 Send now issues the scheduled invoice today before dispatching it", () => {
    const body = fnBody(src, "doSendNow");
    const redate = body.search(/sendNowDates\(/);
    const dispatch = body.search(/dispatchInvoice\(/);
    expect(redate).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(redate);
    expect(body.slice(redate, dispatch)).toMatch(/method: "PUT"/);
  });

  test("REQ-554 m52 the half-delivered note lives on the page (it outlives the card moving track) and is not the failure red", () => {
    expect(fnBody(src, "doSendNow")).toMatch(/onFlash\(/);
    const at = src.indexOf('data-cy="send-partial"');
    expect(at).toBeGreaterThan(-1);
    const tag = src.slice(src.lastIndexOf("<", at), src.indexOf(">", at));
    expect(tag).not.toMatch(/qcard__sendfail/);
    expect(src).toMatch(/data-cy="send-partial-went"/);
    expect(src).toMatch(/data-cy="send-partial-failed"/);
  });

  test("REQ-554 deleting an invoice from its card re-reads in place", () => {
    const body = fnBody(src, "doDeleteInvoice");
    expect(body).not.toMatch(/location\.reload\(/);
    expect(body).toMatch(/onRefresh\(/);
  });
});

describe("REQ-554 m23 /payments refreshes the sidebar after a claim is settled", () => {
  test("REQ-554 ClaimCard's confirm / reject refreshes the dash cache", () => {
    const src = read("front-end/islands/PaymentsPage.tsx");
    expect(src).toMatch(
      /import \{[^}]*\brefreshDash\b[^}]*\} from "\.\.\/lib\/dash-cache\.ts"/,
    );
    const act = fnBody(src, "act");
    expect(act.indexOf("refreshDash()")).toBeGreaterThan(
      act.indexOf("if (!r.ok)"),
    );
  });
});

describe("REQ-554 M9 (extends REQ-493) a change-order decision reaches the owner's open pages", () => {
  test("REQ-554 /co announces the invoice (and the quote) it moved, before its own reload", () => {
    const src = read("front-end/islands/PublicChangeOrderActions.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/change-announce\.ts"/);
    expect(src).not.toMatch(/lib\/change-feed\.ts/);
    const body = fnBody(src, "decide");
    const ok = body.indexOf("setStatus(action === \"approve\"");
    const reload = body.indexOf("location.reload()", ok);
    expect(ok).toBeGreaterThan(-1);
    const between = body.slice(ok, reload);
    expect(between).toMatch(
      /announceChange\(\{ entityType: "invoice", entityId: invoiceId \}\)/,
    );
    expect(between).toMatch(
      /announceChange\(\{ entityType: "quote", entityId: quoteId \}\)/,
    );
  });

  test("REQ-554 the /co route hands the island the order's invoice and quote ids", () => {
    const route = read("front-end/routes/co/[id].tsx");
    const at = route.indexOf("<PublicChangeOrderActions");
    const tag = route.slice(at, route.indexOf("/>", at));
    expect(tag).toMatch(/invoiceId=\{co\.invoice\?\.id\}/);
    expect(tag).toMatch(/quoteId=\{co\.quote\?\.id\}/);
  });
});
