/**
 * REQ-289 — demo issue customers-payments-fieldops-p1: the signer's name field
 * (and the assistant's new-customer phone/email) had no accessible label, and
 * the /customers "New customer" modal had no dialog role.
 *
 * - PublicSignQuote is rendered for real (SSR) and every text field must take
 *   its accessible name from a label or aria-label — never the placeholder
 *   ("Juan Pérez" is not a name for a field).
 * - The other three surfaces only appear after a click (a state change SSR
 *   cannot reach), so their wiring is pinned on the source here and driven in
 *   a browser by e2e/form-a11y/form-a11y.e2e.test.ts.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PublicSignQuote from "../islands/PublicSignQuote.tsx";

/** The accessible name a field gets from its label or ARIA — the placeholder does not count. */
function labelledName(
  doc: ReturnType<DOMParser["parseFromString"]>,
  el: Element,
): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const txt = by.split(/\s+/).map((id) =>
      doc!.getElementById(id)?.textContent ?? ""
    ).join(" ").trim();
    if (txt) return txt;
  }
  const id = el.getAttribute("id");
  if (id) {
    for (const l of doc!.querySelectorAll("label")) {
      if ((l as Element).getAttribute("for") === id) {
        return (l.textContent ?? "").trim();
      }
    }
  }
  let p = el.parentElement;
  while (p) {
    if (p.tagName === "LABEL") return (p.textContent ?? "").trim();
    p = p.parentElement;
  }
  return "";
}

function textFields(html: string) {
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const fields = [...doc.querySelectorAll("input, textarea")]
    .map((n) => n as Element)
    .filter((el) =>
      !["hidden", "submit", "button", "checkbox", "radio"].includes(
        el.getAttribute("type") ?? "",
      )
    );
  return { doc, fields };
}

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-289: the signer's name field is labelled by its label, not its placeholder (${lang})`, () => {
    const html = renderToString(
      <PublicSignQuote quoteId="q1" version={1} lang={lang} />,
    );
    const { doc, fields } = textFields(html);
    assert(fields.length > 0, "the sign ceremony renders a name field");
    for (const el of fields) {
      const name = labelledName(doc, el);
      assert(
        name !== "",
        `field (placeholder "${
          el.getAttribute("placeholder")
        }") has no label or aria-label`,
      );
      assert(
        name !== el.getAttribute("placeholder"),
        `field's only name is its placeholder "${name}"`,
      );
    }
    const expected = lang === "es" ? /nombre/i : /name/i;
    assert(
      fields.some((el) => expected.test(labelledName(doc, el))),
      "the name field is called by its label",
    );
  });
}

Deno.test("REQ-289: PublicQuoteActions — each Name label points at its input (decline and ask forms)", () => {
  const s = src("../islands/PublicQuoteActions.tsx");
  const labels = [
    ...s.matchAll(
      /<label\b[^>]*>\s*\{tFor\(lang, "publicQuoteActions\.nameLabel"\)\}/g,
    ),
  ];
  assertEquals(labels.length, 2, "two Name labels (decline + ask)");
  for (const m of labels) {
    const forId = m[0].match(/htmlFor=\{?"?([\w-]+)/)?.[1];
    assert(forId, `a Name label has no htmlFor: ${m[0].slice(0, 80)}`);
  }
  // each form's name input carries the id its label names
  for (const id of ["pqa-decline-name", "pqa-ask-name"]) {
    assert(s.includes(`htmlFor="${id}"`), `label htmlFor="${id}"`);
    assert(s.includes(`id="${id}"`), `input id="${id}"`);
  }
});

Deno.test("REQ-289: the assistant's new-customer phone and email inputs carry an aria-label", () => {
  // the "Who is this for?" create form: the inputs after its business-name field
  // (the send dialog's own phone/email sit inside a <label> and are fine)
  const all = src("../islands/AsstChat.tsx");
  const s = all.slice(all.indexOf('data-cy="wizard-business-name"'));
  for (const type of ["tel", "email"]) {
    const block = s.match(
      new RegExp(
        `<input\\s+type="${type}"\\s+class="cust-pick__search"[\\s\\S]*?/>`,
      ),
    )?.[0];
    assert(block, `the create form's ${type} input`);
    assert(
      /aria-label=/.test(block),
      `the ${type} input has no aria-label:\n${block}`,
    );
  }
});

Deno.test("REQ-289: the /customers New customer modal is a labelled modal dialog that Escape closes", () => {
  const s = src("../islands/ClientsPage.tsx");
  const modal = s.slice(s.indexOf("{addOpen && ("));
  assert(modal.length > 0, "the add-client modal");
  assert(/role="dialog"/.test(modal), 'role="dialog"');
  assert(/aria-modal="true"/.test(modal), 'aria-modal="true"');
  const labelledBy = modal.match(/aria-labelledby="([\w-]+)"/)?.[1];
  assert(labelledBy, "aria-labelledby");
  assert(
    modal.includes(`id="${labelledBy}"`),
    `the heading carries id="${labelledBy}"`,
  );
  assert(/["']Escape["']/.test(s), "an Escape key handler closes it");
});
