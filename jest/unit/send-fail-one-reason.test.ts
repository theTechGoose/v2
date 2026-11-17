/**
 * REQ-525 — "fix every issue the demo found, loop until there are none".
 * Demo-loop cycle 3, issue p8-pair2-a: "The same 555 send error is shown
 * three times". One failed text wrote one divider, and the chat explained it
 * three times: the divider label ("… text failed — <reason>"), the send
 * card ("Couldn't send — Not delivered — <reason>") and the recovery box
 * headline ("That number can't get texts — check it").
 *
 * The reason now has one home — the send card. The divider says only "Text
 * not delivered", and the recovery box names the action to take.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";

const dicts = [["en", en], ["es", es]] as const;
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("REQ-525 the send failure reason is shown once", () => {
  test.each(dicts)(
    "REQ-525 %s: the divider's text-failure label is short, with no {reason}",
    (_lang, d) => {
      const v =
        (d as Record<string, string>)["sendQuote.divider.textNotDelivered"];
      expect(v).toBeTruthy();
      expect(v).not.toContain("{reason}");
      expect(v).not.toContain("—");
    },
  );

  test("REQ-525: en/es divider labels read 'Text not delivered'", () => {
    expect(
      (en as Record<string, string>)["sendQuote.divider.textNotDelivered"],
    ).toBe("Text not delivered");
    expect(
      (es as Record<string, string>)["sendQuote.divider.textNotDelivered"],
    ).toBe("Mensaje de texto no entregado");
  });

  test("REQ-525: the recovery box names the action, not the failure again", () => {
    expect(en["asstChat.recovery.checkPhone"]).toBe(
      "Fix the number and resend",
    );
    expect(es["asstChat.recovery.checkPhone"]).toBe(
      "Corrige el número y vuelve a enviar",
    );
    for (const [, d] of dicts) {
      expect(d["asstChat.recovery.checkPhone"]).not.toMatch(
        /can.t get texts|no recibe mensajes|—/i,
      );
    }
  });

  test("REQ-525: the send coordinator writes the short label for a text-only failure", () => {
    const src = read(
      "../../backend/src/agents/domain/coordinators/send-quote/mod.ts",
    );
    expect(src).toContain('"sendQuote.divider.textNotDelivered"');
    expect(src).not.toMatch(/"sendQuote\.divider\.textFailed",\s*\{/);
  });

  test("REQ-525: the send card stays the reason's one home", () => {
    const src = read("../../front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /"asstChat\.cta\.notDelivered",\s*\)\}\s*\{dispatchFailReason\}/,
    );
  });
});
