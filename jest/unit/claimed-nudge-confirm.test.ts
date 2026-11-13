/**
 * REQ-250 — demo issue quote-invoice-money-m12 (Pair 9): "a payment reminder
 * can be sent after the client reported paying, with no warning".
 *
 * On a `claimed` invoice card (the customer said "I paid by Zelle") the back
 * face's "Send a nudge" POSTed /api/cron/invoice-reminder on the first click.
 * It now asks first, inline (no browser dialog), naming who said they paid,
 * how, and the reference — and only "Send anyway" sends.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const src = read("front-end/islands/InvoicesPage.tsx");

/** The JSX of the claimed card's nudge, from its data-cy to the next
 *  stage-gated block. */
function claimedNudgeBlock(): string {
  const at = src.indexOf('data-cy="invoice-nudge"');
  expect(at).toBeGreaterThan(-1);
  const start = src.lastIndexOf('inv.stage === "claimed"', at);
  const end = src.indexOf('data-cy="invoice-reject-claim"', at);
  return src.slice(start, end);
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

describe("REQ-250 m12: a nudge on a claimed invoice asks first", () => {
  test("the claimed card's nudge button does not send on its first click", () => {
    const block = claimedNudgeBlock();
    expect(block).not.toMatch(/onClick=\{doSendNudge\}/);
    expect(block).toMatch(/setNudgeAsk\(true\)/);
  });

  test("the inline ask names the claim and only its 'Send anyway' sends", () => {
    expect(src).toMatch(/<ConfirmRow\s+cy="invoice-nudge-ask"/);
    // the yes button's own onClick sends; the no button only closes the ask
    const yesTag = confirmProp("invoice-nudge-ask", "onYes");
    const noTag = confirmProp("invoice-nudge-ask", "onNo");
    expect(yesTag).toMatch(/doSendNudge/);
    expect(noTag).not.toMatch(/doSendNudge/);
    expect(noTag).toMatch(/setNudgeAsk\(false\)/);
    // the ask copy is fed the claimant, the method and the reference
    expect(src).toMatch(
      /"invoicesPage\.back\.nudgeClaimedAsk",\s*\{[^}]*name:[^}]*method:[^}]*ref:/s,
    );
    expect(src).not.toMatch(/\bconfirm\(/); // no browser dialogs
  });

  test("the ask's copy exists in both languages and carries the claim", () => {
    for (const dict of [en, es]) {
      const ask = dict["invoicesPage.back.nudgeClaimedAsk"];
      expect(ask).toBeTruthy();
      for (const p of ["{name}", "{method}", "{ref}"]) expect(ask).toContain(p);
      expect(dict["invoicesPage.back.nudgeClaimedYes"]).toBeTruthy();
      expect(dict["invoicesPage.back.nudgeClaimedNo"]).toBeTruthy();
    }
  });
});
