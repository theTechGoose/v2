/**
 * REQ-438 (demo-loop cycle 3, M7) — "Borra la factura repetida INV-001 por
 * favor." is a request to DELETE an invoice. The chat model has no invoice
 * tool (only quote tools), so it squeezed the request into change_order and
 * pair 1 was asked "¿Cuánto debe sumar Eliminar factura INV-001 a Q-001…?".
 * The coordinator reads the request here and answers how to delete it.
 */

import { isChangeOrderRequest } from "@agents/domain/business/change-order-intent/mod.ts";

export interface InvoiceRemovalRequest {
  /** "INV-001" when the message names one. */
  invoiceNumber?: string;
}

/** delete / void / cancel …, and the Spanish forms (with an attached pronoun). */
const VERB = String
  .raw`(?:borra(?:r|la|lo|las|los|me)?|b[oó]rra(?:la|lo|las|los|me)|elimina(?:r|la|lo)?|elim[ií]na(?:la|lo|me)|anula(?:r|la|lo)?|an[uú]la(?:la|lo)|cancela(?:r|la|lo)?|canc[eé]la(?:la|lo)|delete|remove|void|cancel|scrap|trash|get\s+rid\s+of)`;
/** Words that make the invoice the place of the change, not its object:
 *  "remove the line FROM the invoice", "borra la línea DE la factura". */
const NOT_OBJECT = String
  .raw`(?:from|of|on|in|to|off|de|del|en|al|line|lines|item|items|l[ií]nea|l[ií]neas|concepto|conceptos|partida)`;
const FILLER = String.raw`(?!${NOT_OBJECT}(?![\p{L}\d]))[\p{L}\d'’-]+`;
const OBJECT = String.raw`(?:facturas?|invoices?|INV-\d+)(?![\p{L}\d])`;
const REMOVAL_RE = new RegExp(
  String
    .raw`(?<![\p{L}])${VERB}(?![\p{L}])[\s,]+(?:${FILLER}[\s,]+){0,3}?${OBJECT}`,
  "iu",
);
const INVOICE_NUMBER_RE = /\bINV-\d+\b/i;

/**
 * Read "borra la factura INV-001", "delete invoice INV-002", "void INV-3",
 * "anula la factura duplicada". Undefined when the text is not a request to
 * delete an invoice — a line taken off an invoice, a change order, a billing
 * ask or a question about one are not.
 */
export function parseInvoiceRemoval(
  text: string,
): InvoiceRemovalRequest | undefined {
  if (!text || isChangeOrderRequest(text)) return undefined;
  if (!REMOVAL_RE.test(text)) return undefined;
  const n = text.match(INVOICE_NUMBER_RE);
  return n ? { invoiceNumber: n[0].toUpperCase() } : {};
}

/** "INV-3" and "INV-003" are the same invoice. */
export function sameDocNumber(a: string, b: string): boolean {
  const key = (s: string) => {
    const m = s.trim().toUpperCase().match(/^([A-Z]+)-0*(\d+)$/);
    return m ? `${m[1]}-${m[2]}` : s.trim().toUpperCase();
  };
  return key(a) === key(b);
}
