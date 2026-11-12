/**
 * REQ-327 (demo-loop cycle 1, issue p7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The demo saw "Not delivered" in the chat header next to a GREEN pulsing
 * dot, the CTA sub-line opening in lowercase ("not delivered — …"), and the
 * text recipient printed raw ("+15124308822").
 *
 * Targets: shared/quote-flow/chat-header.ts (headerTone), the ChatHeaderLive
 * island (tone class), AsstChat (dispatches the tone, formats the phone),
 * assistant-page.css (the --bad variants) and lang/{en,es}.json (casing).
 */
import * as fs from "fs";
import * as path from "path";
import { headerTone } from "../../shared/quote-flow/chat-header";

const H = "asstChat.header.";
const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("REQ-327 headerTone — the status line's tone", () => {
  it("'Not delivered' is bad", () => {
    expect(headerTone(`${H}notDelivered`)).toBe("bad");
  });

  it("every other status is ok", () => {
    for (
      const k of [
        "default",
        "newConversation",
        "quoteDrafted",
        "quoteLocked",
        "gatheringInfo",
        "readyToSend",
        "outForSignature",
        "quoteAccepted",
      ]
    ) {
      expect(headerTone(`${H}${k}`)).toBe("ok");
    }
  });
});

describe("REQ-327 copy — the CTA sub-line starts with a capital", () => {
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));

  it("en: 'Not delivered —'", () => {
    expect(en["asstChat.cta.notDelivered"]).toBe("Not delivered —");
  });

  // REQ-413: agrees with the header's "No entregada" (la entrega / la cotización).
  it("es: 'No entregada —'", () => {
    expect(es["asstChat.cta.notDelivered"]).toBe("No entregada —");
  });
});

describe("REQ-327 wiring", () => {
  const header = read("front-end/islands/ChatHeaderLive.tsx");
  const chat = read("front-end/islands/AsstChat.tsx");
  const css = read("front-end/static/assistant-page.css");

  it("ChatHeaderLive reads a tone off the pm:asst-header event and puts it on the dot and the sub-line", () => {
    expect(header).toContain("chat__head-dot--bad");
    expect(header).toContain("chat__head-sub--bad");
    expect(header).toMatch(/detail\.tone/);
  });

  it("AsstChat's header effect dispatches the tone with the status", () => {
    const start = chat.indexOf("// P6.12: keep the chat header fresh");
    expect(start).toBeGreaterThan(-1);
    const effect = chat.slice(start, chat.indexOf("}, [", start));
    expect(effect).toContain("headerTone(");
    expect(effect).toMatch(/detail:\s*\{[^}]*tone/);
  });

  it("AsstChat formats the text recipient with fmtPhone (sms only)", () => {
    expect(chat).toMatch(
      /import \{[^}]*fmtPhone[^}]*\} from "\.\.\/lib\/format\.ts"/,
    );
    const sub = chat.slice(
      chat.indexOf('"asstChat.cta.textedTo"'),
      chat.indexOf('"asstChat.cta.notDelivered"'),
    );
    expect(sub).toMatch(
      /dispatchedChannel === "sms"\s*\?\s*fmtPhone\(sentRecipient\)\s*:\s*sentRecipient/,
    );
  });

  it("the stylesheet carries a red, non-pulsing --bad variant for the dot and the sub-line", () => {
    const dot = css.match(/\.chat__head-dot--bad\s*\{[^}]*\}/)?.[0] ?? "";
    expect(dot).toMatch(/background:\s*var\(--danger\)/);
    expect(dot).toMatch(/animation:\s*none/);
    const sub = css.match(/\.chat__head-sub--bad\s*\{[^}]*\}/)?.[0] ?? "";
    expect(sub).toMatch(/color:\s*var\(--danger\)/);
  });
});
