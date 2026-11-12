/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7: the app said a receipt or invoice went
 * out, or that a client was nudged, when nothing could be delivered.
 *   - pair 9: /invoices "Confirmada 12 nov. El recibo se envió
 *     automáticamente." and /i "Un recibo en PDF está en tu correo" for a
 *     client with no email and a test number;
 *   - pair 10: "Send a nudge" on an invoice with no recipient said "Already
 *     nudged today — the next reminder is scheduled.";
 *   - pair 7: signing showed INV-001 as SENT "automatically" a minute after
 *     the text failed.
 *
 * The copy is chosen from the delivery the backend recorded
 * (`receiptSentVia`, `deliveredVia`, the nudge's `reason`) by the pure
 * helpers here, fed the real dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import {
  nudgeNote,
  outReadKey,
  paidReadKey,
  receiptSentViaOf,
} from "../../shared/documents/delivery-truth";
import { receivedNoteBody } from "../../shared/documents/received-note";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tr =
  (lang: "en" | "es") =>
  (key: string, vars: Record<string, string | number> = {}) => {
    const raw = DICTS[lang][key];
    if (raw === undefined) throw new Error(`missing ${lang} key ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_, k) =>
      k in vars ? String(vars[k]) : `{${k}}`,
    );
  };

const SENT_CLAIM = {
  en: /sent automatically|in your inbox|went out/i,
  es: /se envió automáticamente|en tu correo|se envió/i,
};

describe("REQ-556 (cycle 4, M7) the paid card says where the receipt went — or that it could not go", () => {
  test("receiptSentViaOf accepts only email | text | none", () => {
    expect(receiptSentViaOf("email")).toBe("email");
    expect(receiptSentViaOf("text")).toBe("text");
    expect(receiptSentViaOf("none")).toBe("none");
    expect(receiptSentViaOf(undefined)).toBeUndefined();
    expect(receiptSentViaOf("fax")).toBeUndefined();
  });

  test("nothing delivered → 'receipt ready — couldn't be sent', never 'sent automatically' (en + es)", () => {
    const key = paidReadKey({ receiptSentVia: "none" });
    expect(key).toBe("invoicesPage.read.paidNone");
    for (const lang of ["en", "es"] as const) {
      const s = tr(lang)(key, { date: "Nov 12" });
      expect(s).not.toMatch(SENT_CLAIM[lang]);
      expect(s).toMatch(
        lang === "en" ? /couldn't be sent/i : /no se pudo enviar/i,
      );
      expect(s).toContain("Nov 12");
    }
  });

  test("emailed → the existing 'sent automatically'; texted → 'texted'", () => {
    expect(paidReadKey({ receiptSentVia: "email" })).toBe(
      "invoicesPage.read.paid",
    );
    expect(paidReadKey({ receiptSentVia: "text" })).toBe(
      "invoicesPage.read.paidText",
    );
    expect(tr("en")("invoicesPage.read.paidText", { date: "x" })).toMatch(
      /texted/i,
    );
    expect(tr("es")("invoicesPage.read.paidText", { date: "x" })).toMatch(
      /mensaje de texto/i,
    );
  });

  test("an invoice paid before delivery was recorded claims nothing about the receipt", () => {
    const key = paidReadKey({});
    expect(key).toBe("invoicesPage.read.paidPlain");
    expect(tr("en")(key, { date: "Nov 12" })).toBe("Cleared Nov 12.");
    expect(tr("es")(key, { date: "12 nov" })).toBe("Confirmada 12 nov.");
  });

  test("the InvoicesPage paid card reads paidReadKey, not the fixed read.paid", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/paidReadKey\(inv\)/);
    expect(src).not.toMatch(
      /inv\.stage === "paid"\s*\?\s*tFor\(lang, "invoicesPage\.read\.paid"/,
    );
  });
});

describe("REQ-556 (cycle 4, M7) the paid public invoice never says the receipt is in the inbox when it was not emailed", () => {
  test("none → no inbox claim (en + es)", () => {
    for (const lang of ["en", "es"] as const) {
      const s = receivedNoteBody(tr(lang), lang, {
        who: "Rosa",
        channel: "none",
      });
      expect(s).not.toMatch(SENT_CLAIM[lang]);
      expect(s).toContain("Rosa");
    }
  });

  test("text → says it was texted", () => {
    expect(
      receivedNoteBody(tr("en"), "en", { who: "Rosa", channel: "text" }),
    ).toMatch(/texted/i);
    expect(
      receivedNoteBody(tr("es"), "es", { who: "Rosa", channel: "text" }),
    ).toMatch(/mensaje de texto/i);
  });

  test("email → the existing inbox sentence", () => {
    expect(
      receivedNoteBody(tr("en"), "en", { who: "Rosa", channel: "email" }),
    ).toBe(
      "Thanks! Rosa confirmed your payment. A PDF receipt is in your inbox.",
    );
  });

  test("/i's ReceivedNote passes the recorded channel (receiptSentVia) to receivedNoteBody", () => {
    const src = read("front-end/routes/i/[id].tsx");
    const note = src.slice(src.indexOf("function ReceivedNote("));
    const body = note.slice(0, note.indexOf("\n}\n"));
    expect(body).toMatch(/receivedNoteBody\([\s\S]*?\bchannel,?\s*\}\)/);
    const call = src.slice(src.indexOf("<ReceivedNote"));
    expect(call.slice(0, call.indexOf("/>"))).toMatch(/receiptSentVia/);
  });
});

describe("REQ-556 (cycle 4, M7) a nudge that reached nobody says so", () => {
  test("no recipient → 'No email or phone on file', shown as a failure", () => {
    const n = nudgeNote({ channels: [], reason: "no_recipient" });
    expect(n).toEqual({ tone: "fail", key: "invoicesPage.nudge.noRecipient" });
    expect(tr("en")(n.key)).toMatch(/no email or phone on file/i);
    expect(tr("es")(n.key)).toMatch(/correo ni teléfono/i);
    expect(tr("en")(n.key)).not.toMatch(/already nudged/i);
  });

  test("every channel failed → 'couldn't be delivered', a failure", () => {
    const n = nudgeNote({ channels: [], reason: "not_delivered" });
    expect(n).toEqual({ tone: "fail", key: "invoicesPage.nudge.notDelivered" });
    expect(tr("en")(n.key)).toMatch(/couldn't be delivered/i);
    expect(tr("es")(n.key)).toMatch(/no se pudo entregar/i);
  });

  test("muted → says muted; already fired → the existing 'already nudged'; delivered → 'sent'; no reply → failed", () => {
    expect(nudgeNote({ channels: [], reason: "muted" })).toEqual({
      tone: "note",
      key: "invoicesPage.nudge.muted",
    });
    expect(tr("es")("invoicesPage.nudge.muted")).toMatch(/silenciad/i);
    expect(nudgeNote({ channels: [], reason: "already_fired" })).toEqual({
      tone: "note",
      key: "invoicesPage.nudge.alreadySent",
    });
    expect(nudgeNote({ channels: ["email"] })).toEqual({
      tone: "note",
      key: "invoicesPage.nudge.sent",
    });
    expect(nudgeNote(null)).toEqual({
      tone: "fail",
      key: "invoicesPage.nudge.failed",
    });
  });

  test("the overdue card's nudge reads nudgeNote", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const fn = src.slice(src.indexOf("async function doSendNudge("));
    expect(fn.slice(0, fn.indexOf("\n  }\n"))).toMatch(/nudgeNote\(/);
  });
});

describe("REQ-556 (cycle 4, M7) an invoice signing billed but nobody received says so on its card", () => {
  test("deliveredVia [] → the out card says it was not emailed or texted (en + es)", () => {
    expect(outReadKey({ deliveredVia: [] })).toBe(
      "invoicesPage.read.outUndelivered",
    );
    const en = tr("en")("invoicesPage.read.outUndelivered", {
      issued: "Nov 12",
      due: "Nov 19",
    });
    expect(en).toMatch(/not emailed or texted/i);
    expect(en).toContain("Nov 19");
    expect(
      tr("es")("invoicesPage.read.outUndelivered", { issued: "a", due: "b" }),
    ).toMatch(/no se envió/i);
  });

  test("delivered, or no record (sent by the contractor) → the plain 'Issued … Due …'", () => {
    expect(outReadKey({ deliveredVia: ["email"] })).toBe(
      "invoicesPage.read.out",
    );
    expect(outReadKey({})).toBe("invoicesPage.read.out");
  });

  test("the InvoicesPage out card reads outReadKey, and its day-one subline says 'Issued today', not 'Sent today', when nobody received it", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/tFor\(lang, outReadKey\(inv\)/);
    expect(src).toMatch(
      /inv\.daysIn < 1 && wasUndelivered\(inv\)\s*\?\s*tFor\(lang, "invoicesPage\.subline\.issuedToday"/,
    );
    expect(
      tr("en")("invoicesPage.subline.issuedToday", { date: "Nov 19" }),
    ).toBe("Issued today · due Nov 19");
    expect(
      tr("es")("invoicesPage.subline.issuedToday", { date: "19 nov" }),
    ).toBe("Emitida hoy · vence 19 nov");
  });
});
