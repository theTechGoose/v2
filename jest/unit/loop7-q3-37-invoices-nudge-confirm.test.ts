/**
 * REQ-1112 (LOOP-007 cycle 3, issue q3-37; amends REQ-477, follows REQ-704 /
 * REQ-1031) — "'Send nudge' on the overdue card emails the customer in one
 * click with no preview".
 *
 * Every /invoices entry point that sends an invoice's reminder nudge — the
 * overdue card's front CTA (`invoice-cta-overdue` → ctaAction), the back
 * face's `invoice-back-cta-overdue` (also ctaAction), the back face's
 * "Send a nudge" (`invoice-nudge`) and the detail panel's stage action
 * (runStageAction) — must open REQ-1031's InvoiceNudgeDialog (the backend's
 * reminder preview + Send / Cancel) first, the way the customer page's Remind
 * does. None of them may call doSendNudge / sendInvoiceNudge directly.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const FILE = "front-end/islands/InvoicesPage.tsx";
const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");

/** the body of `function <name>(` up to its matching closing brace */
function fnBody(name: string): string {
  const at = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (at < 0) throw new Error(`${FILE} has no function ${name}`);
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

/** the onClick handler of the element carrying data-cy="<cy>" */
function onClickOf(cy: string): string {
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`${FILE} has no data-cy="${cy}"`);
  const on = src.indexOf("onClick={", at);
  let depth = 0;
  for (let i = on + "onClick=".length; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(on, i + 1);
  }
  throw new Error(`unbalanced onClick for ${cy}`);
}

/** the line(s) of ctaAction that handle stage "overdue" */
function overdueBranch(): string {
  const body = fnBody("ctaAction");
  const m = body.match(/if\s*\(\s*inv\.stage\s*===\s*"overdue"\s*\)[^\n;]*;?/);
  return m ? m[0] : "";
}

const DIRECT_SEND = /\b(doSendNudge|sendInvoiceNudge)\s*\(/;

describe("REQ-1112 (LOOP-007 q3, q3-37) every /invoices nudge confirms with the preview first", () => {
  it("REQ-1112 q3-37 InvoicesPage.tsx imports REQ-1031's InvoiceNudgeDialog", () => {
    expect(src).toMatch(
      /import\s+InvoiceNudgeDialog\s+from\s+"\.\.\/components\/InvoiceNudgeDialog\.tsx"/,
    );
  });

  it("REQ-1112 q3-37 the overdue card's 'Send nudge' (ctaAction, front + back CTA) does not send in one tap", () => {
    const branch = overdueBranch();
    expect({ branch, sendsDirectly: DIRECT_SEND.test(branch) }).toEqual(
      expect.objectContaining({ sendsDirectly: false }),
    );
  });

  it("REQ-1112 q3-37 the back face's 'Send a nudge' (invoice-nudge) never calls doSendNudge/sendInvoiceNudge directly", () => {
    const handler = onClickOf("invoice-nudge");
    expect({ handler, sendsDirectly: DIRECT_SEND.test(handler) }).toEqual(
      expect.objectContaining({ sendsDirectly: false }),
    );
  });

  it("REQ-1112 q3-37 the detail panel's nudge (runStageAction) opens the dialog, not dispatch.doSendNudge", () => {
    const body = fnBody("runStageAction");
    expect({ body, sendsDirectly: DIRECT_SEND.test(body) }).toEqual(
      expect.objectContaining({ sendsDirectly: false }),
    );
  });

  it("REQ-1112 q3-37 InvoiceNudgeDialog is rendered on /invoices (its onSend is the one nudge sender)", () => {
    expect(src).toMatch(/<InvoiceNudgeDialog\b/);
  });
});
