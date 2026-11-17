/**
 * REQ-707 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m61: "'No lo recibí'
 * confirm has unstyled browser buttons and text past the card padding".
 *
 * The claimed card's reject ask (REQ-488) and nudge ask (REQ-250) rendered
 * two bare <button>s — the browser's grey defaults — in a container with
 * `padding:0 0 10px`, outside .qcard__back-body's 22px side padding, so the
 * question ran to the card edge. The delete ask on the same card already had
 * an outlined coral Yes and a ghost No. All three asks now render through one
 * <ConfirmRow>: a house-styled outlined Yes (danger or primary), a ghost No,
 * and, when it sits at card level, the body's 22px side inset.
 */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import ConfirmRow from "./ConfirmRow.tsx";

const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

/** The declarations of the first rule whose selector list is exactly `sel`. */
function rule(css: string, sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  assert(m, `quotes.css has a rule for ${sel}`);
  return m[1];
}

Deno.test("REQ-707 m61: ConfirmRow renders a styled Yes, a ghost No and the ask", () => {
  const doc = parse(renderToString(
    <ConfirmRow
      cy="invoice-reject-ask"
      ask="Mark Maria's payment not received?"
      yesLabel="Mark not received"
      noLabel="Cancel"
      onYes={() => {}}
      onNo={() => {}}
      tone="danger"
      inset
    />,
  ));
  const row = doc.querySelector("[data-cy='invoice-reject-ask']")!;
  assert(row, "the row carries its data-cy");
  assertEquals(row.getAttribute("role"), "alert");
  assertMatch(row.className, /\bconfirm-row\b/);
  assertMatch(row.className, /\bconfirm-row--inset\b/);
  assertEquals(
    row.querySelector(".confirm-row__ask")?.textContent,
    "Mark Maria's payment not received?",
  );
  const yes = doc.querySelector("[data-cy='invoice-reject-ask-yes']")!;
  const no = doc.querySelector("[data-cy='invoice-reject-ask-no']")!;
  assertEquals(yes.getAttribute("type"), "button");
  assertEquals(no.getAttribute("type"), "button");
  assertMatch(yes.className, /\bconfirm-row__yes\b/);
  assertMatch(yes.className, /\bconfirm-row__yes--danger\b/);
  assertMatch(no.className, /\bconfirm-row__no\b/);
  assertEquals(yes.textContent, "Mark not received");
  assertEquals(no.textContent, "Cancel");
});

Deno.test("REQ-707 m61: ConfirmRow takes custom Yes/No ids, a primary tone, and no inset", () => {
  const doc = parse(renderToString(
    <ConfirmRow
      cy="invoice-card-delete-ask"
      yesCy="invoice-card-delete-confirm"
      noCy="invoice-card-delete-cancel"
      ask="Delete?"
      yesLabel="Delete"
      noLabel="Keep"
      onYes={() => {}}
      onNo={() => {}}
      tone="primary"
      busy
    />,
  ));
  const row = doc.querySelector("[data-cy='invoice-card-delete-ask']")!;
  assert(!/confirm-row--inset/.test(row.className), "no inset inside the body");
  const yes = doc.querySelector("[data-cy='invoice-card-delete-confirm']")!;
  assertMatch(yes.className, /\bconfirm-row__yes--primary\b/);
  assert(yes.hasAttribute("disabled"), "busy disables Yes");
  assert(doc.querySelector("[data-cy='invoice-card-delete-cancel']"));
});

Deno.test("REQ-707 m61: quotes.css styles the row: outlined Yes, ghost No, body-matching inset", async () => {
  const css = await read("../static/quotes.css");
  const inset = rule(css, ".confirm-row--inset");
  // .qcard__back-body pads 18px 22px — the card-level ask lines up with it.
  assertMatch(rule(css, ".qcard__back-body"), /padding:\s*18px 22px/);
  assertMatch(inset, /padding:\s*0 22px 12px/);
  const yes = rule(css, ".confirm-row__yes");
  assertMatch(yes, /appearance:\s*none/);
  assertMatch(yes, /background:\s*#fff/);
  assertMatch(yes, /border:\s*1px solid/);
  assertMatch(yes, /border-radius:\s*7px/);
  assertMatch(
    rule(css, ".confirm-row__yes--danger"),
    /border-color:\s*var\(--brand-pink/,
  );
  assertMatch(
    rule(css, ".confirm-row__yes--primary"),
    /border-color:\s*var\(--brand-teal/,
  );
  const no = rule(css, ".confirm-row__no");
  assertMatch(no, /appearance:\s*none/);
  assertMatch(no, /background:\s*none/);
  assertMatch(no, /border:\s*none/);
});

Deno.test("REQ-707 m61: the card's delete, nudge and reject asks all render through ConfirmRow", async () => {
  const src = await read("../islands/InvoicesPage.tsx");
  assertMatch(
    src,
    /import ConfirmRow from "\.\.\/components\/ConfirmRow\.tsx"/,
  );
  for (const cy of ["invoice-reject-ask", "invoice-nudge-ask"]) {
    const at = src.indexOf(`cy="${cy}"`);
    assert(at > -1, `${cy} is a ConfirmRow`);
    const tag = src.slice(src.lastIndexOf("<ConfirmRow", at), at);
    assert(!tag.includes("/>"), `${cy} sits on the ConfirmRow tag`);
    const props = src.slice(at, src.indexOf("/>", at));
    assertMatch(props, /\binset\b/, `${cy} is inset like the body`);
  }
  assertMatch(
    src.slice(
      src.indexOf('cy="invoice-reject-ask"'),
      src.indexOf("/>", src.indexOf('cy="invoice-reject-ask"')),
    ),
    /tone="danger"/,
  );
  assert(src.includes('yesCy="invoice-card-delete-confirm"'), "delete uses it");
  // No bare, unclassed button is left in any of the three asks.
  assert(!/data-cy="invoice-(reject|nudge)-ask-(yes|no)"/.test(src));
});
