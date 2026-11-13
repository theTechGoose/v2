/**
 * REQ-488 — demo-loop cycle 3, issues m56 + m57: "'No lo recibí' has no
 * confirm and tells the client nothing" and "the claim chip stays after the
 * claim was rejected".
 *
 * On a claimed invoice card the back face's "Didn't get it" POSTed
 * /api/invoices/:id/reject-claim on the first click. It now asks first,
 * inline, naming who said they paid and how — and only its "Mark not
 * received" rejects. The customer's /i then explains the payment hasn't
 * arrived and where to check it went (`claimRejectedNote`).
 */
import * as fs from "fs";
import * as path from "path";
import { claimRejectedNote } from "../../shared/documents/claim-rejected-note";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tr =
  (lang: "en" | "es") =>
  (key: string, vars: Record<string, string | number> = {}) =>
    DICTS[lang][key].replace(
      /\{(\w+)\}/g,
      (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
    );
const src = read("front-end/islands/InvoicesPage.tsx");
const pub = read("front-end/routes/i/[id].tsx");

function buttonTag(dataCy: string): string {
  const at = src.indexOf(`data-cy="${dataCy}"`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(
    src.lastIndexOf("<button", at),
    src.indexOf("</button>", at),
  );
}

// REQ-707 (cycle 5, m61): the ask renders through <ConfirmRow cy=…>; its
// onYes / onNo props are the Yes / No buttons' click handlers.
function confirmProp(cy: string, prop: "onYes" | "onNo"): string {
  const at = src.indexOf(`cy="${cy}"`);
  expect(at).toBeGreaterThan(-1);
  const block = src.slice(at, src.indexOf("/>", at));
  const p = block.indexOf(`${prop}=`);
  expect(p).toBeGreaterThan(-1);
  const next = block.slice(p + 1).search(/\n\s+\w+=/);
  return block.slice(p, next < 0 ? undefined : p + 1 + next);
}

describe("REQ-488 m56: 'Didn't get it' asks first", () => {
  test("the claimed card's reject button does not POST on its first click", () => {
    const tag = buttonTag("invoice-reject-claim");
    expect(tag).not.toMatch(/onClick=\{doRejectClaim\}/);
    expect(tag).toMatch(/setRejectAsk\(true\)/);
  });

  test("the inline ask names the claim; only 'Mark not received' rejects", () => {
    expect(src).toMatch(/<ConfirmRow\s+cy="invoice-reject-ask"/);
    const yes = confirmProp("invoice-reject-ask", "onYes");
    const no = confirmProp("invoice-reject-ask", "onNo");
    expect(yes).toMatch(/doRejectClaim/);
    expect(no).not.toMatch(/doRejectClaim/);
    expect(no).toMatch(/setRejectAsk\(false\)/);
    expect(src).toMatch(
      /"invoicesPage\.back\.rejectAsk",\s*\{[^}]*name:[^}]*method:/s,
    );
    expect(src).not.toMatch(/\bconfirm\(/); // no browser dialogs
  });

  test("the ask's copy exists in both languages and says the client will be told", () => {
    for (const dict of [DICTS.en, DICTS.es]) {
      const ask = dict["invoicesPage.back.rejectAsk"];
      expect(ask).toBeTruthy();
      for (const p of ["{name}", "{method}"]) expect(ask).toContain(p);
      expect(dict["invoicesPage.back.rejectYes"]).toBeTruthy();
      expect(dict["invoicesPage.back.rejectNo"]).toBeTruthy();
    }
    expect(
      tr("es")("invoicesPage.back.rejectAsk", {
        name: "Maria Lopez",
        method: "por Zelle",
      }),
    ).toBe(
      "¿Marcar el pago de Maria Lopez por Zelle como no recibido? La factura vuelve a pendiente y su enlace le dirá que el pago no ha llegado.",
    );
  });
});

describe("REQ-488 m56: the customer's /i says the payment hasn't arrived", () => {
  test("a rejected claim with the contractor's Zelle handle names where to check", () => {
    const n = claimRejectedNote(tr("es"), {
      status: "sent",
      claimRejectedAt: "2026-11-12T10:00:00.000Z",
      methodName: "Zelle",
      handle: "rosa@zelle.com",
      who: "Rosa",
    });
    expect(n).toEqual({
      heading: "Rosa aún no ha recibido tu pago",
      body:
        "Tu pago (Zelle) no ha llegado. Revisa que se haya enviado a rosa@zelle.com y luego elige abajo cómo pagaste.",
    });
    const en = claimRejectedNote(tr("en"), {
      status: "sent",
      claimRejectedAt: "2026-11-12T10:00:00.000Z",
      methodName: "Zelle",
      handle: "rosa@zelle.com",
      who: "Rosa",
    });
    expect(en).toEqual({
      heading: "Rosa hasn't received your payment yet",
      body:
        "Your Zelle payment hasn't arrived. Check that it went to rosa@zelle.com, then pick how you paid below.",
    });
  });

  test("without a handle it still says so; no marker, a paid or a re-claimed invoice shows nothing", () => {
    const n = claimRejectedNote(tr("en"), {
      status: "sent",
      claimRejectedAt: "2026-11-12T10:00:00.000Z",
      methodName: "Cash",
      who: "Rosa",
    });
    expect(n?.body).toBe(
      "Your Cash payment hasn't arrived. Check that it went through, then pick how you paid below.",
    );
    const base = { methodName: "Zelle", who: "Rosa" };
    expect(claimRejectedNote(tr("en"), { ...base, status: "sent" })).toBeNull();
    expect(claimRejectedNote(tr("en"), {
      ...base,
      status: "paid",
      claimRejectedAt: "2026-11-12T10:00:00.000Z",
    })).toBeNull();
    expect(claimRejectedNote(tr("en"), {
      ...base,
      status: "claimed",
      claimRejectedAt: "2026-11-12T10:00:00.000Z",
    })).toBeNull();
  });

  test("/i renders the note from the invoice's claimRejectedAt + method, above the pay UI", () => {
    expect(pub).toMatch(/claimRejectedNote\(/);
    expect(pub).toMatch(/claimRejectedAt/);
    expect(pub).toMatch(/claimRejectedMethod/);
    expect(pub).toMatch(/data-claim-rejected/);
  });
});
