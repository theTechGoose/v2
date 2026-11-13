/**
 * REQ-326 — demo-loop cycle 1, issue m39: "Zelle instructions show raw
 * digits 'Envía a 5125550108 por Zelle'".
 *
 * The public claim island interpolated the owner's Zelle/Cash App handle
 * verbatim. A handle that is a phone number (the Zelle field accepts
 * "email or phone") is shown the way the contractor phone on the same page
 * already is — "(512) 555-0108" — while emails and $cashtags stay as typed.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtPayHandle } from "../../front-end/lib/format";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

describe("REQ-326 m39 fmtPayHandle: a phone-shaped pay handle reads as a phone", () => {
  it("REQ-326 10 raw digits → (512) 555-0108", () => {
    expect(fmtPayHandle("5125550108")).toBe("(512) 555-0108");
  });
  it("REQ-326 +1 / 1-prefixed and punctuated forms → the same display", () => {
    expect(fmtPayHandle("+15125550108")).toBe("(512) 555-0108");
    expect(fmtPayHandle("15125550108")).toBe("(512) 555-0108");
    expect(fmtPayHandle("512-555-0108")).toBe("(512) 555-0108");
    expect(fmtPayHandle("(512) 555 0108")).toBe("(512) 555-0108");
  });
  it("REQ-326 emails, $cashtags and @handles are untouched", () => {
    expect(fmtPayHandle("rosa@example.com")).toBe("rosa@example.com");
    expect(fmtPayHandle("$rosacleans")).toBe("$rosacleans");
    expect(fmtPayHandle("@rosa-cleans")).toBe("@rosa-cleans");
    expect(fmtPayHandle("rosa2024")).toBe("rosa2024");
    expect(fmtPayHandle("12345")).toBe("12345");
    expect(fmtPayHandle("")).toBe("");
  });
  it("REQ-326 the Spanish Zelle line no longer carries raw digits", () => {
    const line = fill(es["publicInvoiceClaim.instructions.sendToHandle"], {
      handle: fmtPayHandle("5125550108"),
      svc: "Zelle",
    });
    expect(line).toBe("Envía a (512) 555-0108 por Zelle.");
    expect(en["publicInvoiceClaim.instructions.sendToHandle"]).toBeTruthy();
  });
});

describe("REQ-326 m39 the claim island formats the handle it shows", () => {
  const src = read("front-end/islands/PublicInvoiceClaim.tsx");
  it("REQ-326 imports fmtPayHandle from lib/format", () => {
    expect(src).toMatch(
      /import \{[^}]*\bfmtPayHandle\b[^}]*\} from "\.\.\/lib\/format\.ts"/,
    );
  });
  it("REQ-326 sendToHandle is given the formatted handle, never m.handle raw", () => {
    const at = src.indexOf("publicInvoiceClaim.instructions.sendToHandle");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("svc,", at));
    expect(block).toMatch(/handle:\s*fmtPayHandle\(m\.handle\)/);
  });
});
