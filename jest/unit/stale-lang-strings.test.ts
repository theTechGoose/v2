/**
 * REQ-712 (demo-loop cycle 5, issue m7) — no word stays in the other
 * language. In the demo a Spanish factura's chat chip read "ENVIADO" (the
 * quote's masculine word), and "Recordatorio enviado" stayed on an invoice
 * card after switching to EN: the card kept the string translated when the
 * nudge ran, not something it could word again in the live language.
 */
import * as fs from "fs";
import * as path from "path";
import { invoiceCardChipKey } from "../../shared/quote-flow/chat-invoice-card";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("REQ-712 m7: stale-language strings", () => {
  test("REQ-712: an invoice card's chip reads the invoice's words — sent/pending → Enviada, viewed/opened → Vista", () => {
    expect(invoiceCardChipKey("sent")).toBe("invoices.state.sent");
    expect(invoiceCardChipKey("pending")).toBe("invoices.state.sent");
    expect(invoiceCardChipKey("viewed")).toBe("invoices.state.viewed");
    expect(invoiceCardChipKey("opened")).toBe("invoices.state.viewed");
    expect(invoiceCardChipKey(undefined)).toBe("invoices.state.sent");
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(es[invoiceCardChipKey("sent")]).toBe("Enviada");
    expect(es[invoiceCardChipKey("viewed")]).toBe("Vista");
    expect(en[invoiceCardChipKey("sent")]).toBe("Sent");
    expect(en[invoiceCardChipKey("viewed")]).toBe("Viewed");
  });

  test("REQ-712: the signed divider's preview key exists in en + es and carries {label}", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["acceptQuote.signed.preview"]).toBe("✓ {label}");
    expect(es["acceptQuote.signed.preview"]).toBe("✓ {label}");
  });

  test("REQ-712: InvoicesPage never puts a pre-worded string into a card's send failure / note", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const calls = [...src.matchAll(/setSend(?:Fail|Note)\(([^)]*)/g)].map(
      (m) => m[0],
    );
    expect(calls.length).toBeGreaterThan(5);
    const worded = calls.filter((c) => !/\(\s*(null|worded\b)/.test(c));
    expect(worded).toEqual([]);
  });
});
