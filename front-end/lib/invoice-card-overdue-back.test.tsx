/**
 * REQ-985 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 1, issue q1-63:
 * "Overdue card suggests a text for a client with no phone and lists 'View
 * as customer' twice".
 *
 * (1) The /invoices card back renders its own "View as customer" link
 *     (data-cy=invoice-view-as-customer) AND mounts <InvoiceStageActions>,
 *     which always renders a second "View as customer" (invoice-card-open).
 * (2) The overdue card's line is always "Past due {n} days. A friendly text
 *     usually unsticks it." — even for a client with no phone that can take a
 *     text. Contract for the fix: a pure `overdueReadText(inv, lang)` in
 *     lib/invoice-card.ts, used by the card's readText for the overdue stage.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { InvoiceStageActions } from "../components/InvoiceStageActions.tsx";
import { tFor } from "./i18n.ts";
import * as card from "./invoice-card.ts";

const SRC = await Deno.readTextFile(
  new URL("../islands/InvoicesPage.tsx", import.meta.url),
);
const ID = "0b6c1d2e-aaaa-4bbb-8ccc-1234567890ab";

/** the InvoiceCard function's source, start to the next top-level function */
function invoiceCardSrc(): string {
  const start = SRC.indexOf("function InvoiceCard(");
  assert(start >= 0, "InvoiceCard is in islands/InvoicesPage.tsx");
  const end = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, end < 0 ? undefined : end);
}

/** the card back's action foot: from qcard__back-body to the end of the card */
function cardBackSrc(): string {
  const c = invoiceCardSrc();
  const at = c.indexOf('class="qcard__back-body"');
  assert(at >= 0, "the card has a back body");
  return c.slice(at);
}

/** literal props the card back passes to <InvoiceStageActions …/> */
function stageActionsLiteralProps(back: string): Record<string, unknown> {
  const at = back.indexOf("<InvoiceStageActions");
  if (at < 0) return {};
  const tag = back.slice(at, back.indexOf("/>", at));
  const props: Record<string, unknown> = {};
  for (const m of tag.matchAll(/(\w+)=\{(true|false)\}/g)) {
    props[m[1]] = m[2] === "true";
  }
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) props[m[1]] = m[2];
  return props;
}

Deno.test("REQ-985 (LOOP-007 q1-63): the /invoices card back lists 'View as customer' exactly once", () => {
  const back = cardBackSrc();
  const viewLabel = tFor("en", "invoicesPage.back.viewAsCustomer");
  assertEquals(viewLabel, "View as customer");
  assertEquals(tFor("en", "invoicesPage.detail.viewAsCustomer"), viewLabel);

  // the card's own links labelled "View as customer"
  const own =
    (back.match(/invoicesPage\.(back|detail)\.viewAsCustomer/g) ?? []).length;

  // plus whatever the shared component renders, with the props the card
  // passes it (rendered through the real component)
  let fromComponent = 0;
  if (back.includes("<InvoiceStageActions")) {
    const props = stageActionsLiteralProps(back);
    const html = renderToString(
      <InvoiceStageActions
        stage="overdue"
        invoiceId={ID}
        invoiceLang="en"
        lang="en"
        busy={false}
        cyPrefix="invoice-card"
        showStageCta={false}
        {...props}
      />,
    );
    const doc = new DOMParser().parseFromString(
      `<div>${html}</div>`,
      "text/html",
    )!;
    fromComponent = [...doc.querySelectorAll("a,button")].filter((el) =>
      el.textContent.trim() === viewLabel
    ).length;
  }
  assertEquals(
    own + fromComponent,
    1,
    `card back renders 'View as customer' ${own} time(s) itself + ${fromComponent} via <InvoiceStageActions>`,
  );
});

type OverdueInv = {
  daysOverdue: number;
  textPhone?: string | null;
  email?: string | null;
};
// deno-lint-ignore no-explicit-any
const overdueReadText = (card as any).overdueReadText as
  | ((inv: OverdueInv, lang: "en" | "es") => string)
  | undefined;

Deno.test("REQ-985 (LOOP-007 q1-63): an overdue client with only an email is not told to send a text", () => {
  assert(
    typeof overdueReadText === "function",
    "lib/invoice-card.ts exports overdueReadText(inv, lang) — the overdue line depends on how the nudge can reach the client",
  );
  for (const textPhone of [null, "", "555"]) {
    const en = overdueReadText!(
      { daysOverdue: 5, textPhone, email: "maria@example.com" },
      "en",
    );
    assert(/5/.test(en), `names the days: ${en}`);
    assert(
      !/\btext\b/i.test(en),
      `no phone that can take a text (${textPhone}) — must not suggest a text: "${en}"`,
    );
    const es = overdueReadText!(
      { daysOverdue: 5, textPhone, email: "maria@example.com" },
      "es",
    );
    assert(!/mensaje/i.test(es), `es must not suggest a text either: "${es}"`);
  }
});

Deno.test("REQ-985 (LOOP-007 q1-63): an overdue client with no email and no phone is told to add one", () => {
  assert(typeof overdueReadText === "function", "overdueReadText exported");
  const en = overdueReadText!(
    { daysOverdue: 1, textPhone: null, email: null },
    "en",
  );
  assert(!/\btext\b/i.test(en), `must not suggest a text: "${en}"`);
  assert(
    /email|phone/i.test(en),
    `says there is no way to reach them: "${en}"`,
  );
});

Deno.test("REQ-985 (LOOP-007 q1-63): an overdue client with a textable phone keeps the text advice", () => {
  assert(typeof overdueReadText === "function", "overdueReadText exported");
  assertEquals(
    overdueReadText!(
      { daysOverdue: 3, textPhone: "+15125550123", email: null },
      "en",
    ),
    tFor("en", "invoicesPage.read.overdue.other", { n: 3 }),
  );
  assertEquals(
    overdueReadText!({ daysOverdue: 1, textPhone: "+15125550123" }, "en"),
    tFor("en", "invoicesPage.read.overdue.one", { n: 1 }),
  );
});

Deno.test("REQ-985 (LOOP-007 q1-63): the card's overdue line goes through overdueReadText", () => {
  const c = invoiceCardSrc();
  const at = c.indexOf("const readText");
  assert(at >= 0, "the card computes readText");
  const expr = c.slice(at, c.indexOf('inv.stage === "out"', at));
  assert(
    /overdueReadText\(/.test(expr),
    `readText's overdue branch must use overdueReadText(…), got:\n${expr}`,
  );
});
