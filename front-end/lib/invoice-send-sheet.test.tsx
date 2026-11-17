/**
 * REQ-727 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue c4-M16 / m56: invoices went out at once
 * from /invoices — no channel choice, no preview, no confirm. The invoice
 * send sheet is rendered for real (SSR): it names the invoice and the
 * client, offers the three channels on lib/send-dialog.ts's rules, says
 * which language it goes out in (the invoice's own), keeps "What they'll
 * get" one tap away, and sends only on its Send button.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import InvoiceSendDialog from "../components/InvoiceSendDialog.tsx";

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")!;

const INVOICE = { id: "inv-1", number: "INV-001", lang: "es" };

function render(
  customer: {
    id?: string;
    name?: string;
    email?: string;
    phoneNumber?: string;
  } | null,
  uiLang: "en" | "es" = "en",
  invoice: { id: string; number?: string; lang?: string } = INVOICE,
) {
  return parse(renderToString(
    <InvoiceSendDialog
      lang={uiLang}
      invoice={invoice}
      customer={customer}
      onCancel={() => {}}
      onSend={() => Promise.resolve()}
    />,
  ));
}

Deno.test("REQ-727 (c4-M16) the sheet names the invoice and the client and offers Text + Email / Text / Email, Recommended on what is on file", () => {
  const doc = render({
    id: "c-1",
    name: "Juan Perez",
    email: "juan@example.com",
    phoneNumber: "+15125551234",
  });
  const dialog = doc.querySelector('[data-cy="send-dialog"]');
  assert(dialog, "the send sheet renders");
  assertEquals(dialog.getAttribute("role"), "dialog");
  assertEquals(
    doc.querySelector("h4")!.textContent.trim(),
    "How do you want to send INV-001 to Juan Perez?",
  );
  for (const ch of ["both", "sms", "email"]) {
    assert(
      doc.querySelector(`[data-cy="send-option-${ch}"]`),
      `the ${ch} channel is offered`,
    );
  }
  const both = doc.querySelector('[data-cy="send-option-both"]')!;
  assertEquals(both.getAttribute("aria-checked"), "true");
  assertStringIncludes(both.textContent, "Recommended");
  // nothing is asked for: everything is on file
  assertEquals(doc.querySelector('[data-cy="send-add-email"]'), null);
  assertEquals(doc.querySelector('[data-cy="send-add-phone"]'), null);
  // a confirm step: Cancel and Send — nothing goes until Send
  assertEquals(
    doc.querySelector('[data-cy="send-cancel"]')!.textContent.trim(),
    "Cancel",
  );
  assertEquals(
    doc.querySelector('[data-cy="send-keep"]')!.textContent.trim(),
    "Send",
  );
});

Deno.test("REQ-727 (c4-M16) 'Sends in' starts on the invoice's own language — Español for a Spanish invoice in the English app — and 'What they'll get' is one tap away", () => {
  const doc = render({ id: "c-1", name: "Juan Perez", email: "j@x.co" });
  const group = doc.querySelector('[data-cy="send-lang"]');
  assert(group, "the send language is named");
  assertStringIncludes(group.textContent, "Sends in");
  assertEquals(
    doc.querySelector('[data-cy="send-lang-es"]')!.getAttribute("aria-pressed"),
    "true",
  );
  assertEquals(
    doc.querySelector('[data-cy="send-lang-en"]')!.getAttribute("aria-pressed"),
    "false",
  );
  const details = doc.querySelector('[data-cy="send-preview"]')!;
  assertEquals(details.tagName, "DETAILS");
  assertEquals(details.hasAttribute("open"), false, "collapsed until asked");
  assertStringIncludes(
    details.querySelector("summary")!.textContent,
    "What they'll get",
  );
});

Deno.test("REQ-727 (c4-M16) a client with only a phone starts on Text; with nothing on file the sheet asks for both — in Spanish in the Spanish app", () => {
  const phoneOnly = render({
    id: "c-1",
    name: "Ana",
    phoneNumber: "+15125551234",
  });
  assertEquals(
    phoneOnly.querySelector('[data-cy="send-option-sms"]')!.getAttribute(
      "aria-checked",
    ),
    "true",
  );
  assertStringIncludes(
    phoneOnly.querySelector('[data-cy="send-needs-email"]')!.textContent,
    "needs an email",
  );

  const nothing = render({ id: "c-1" }, "es", {
    id: "inv-2",
    number: "INV-002",
  });
  assertEquals(
    nothing.querySelector("h4")!.textContent.trim(),
    "¿Cómo quieres enviar INV-002 a tu cliente?",
  );
  assert(nothing.querySelector('[data-cy="send-add-email"]'));
  assert(nothing.querySelector('[data-cy="send-add-phone"]'));
  assertEquals(
    nothing.querySelector('[data-cy="send-keep"]')!.textContent.trim(),
    "Enviar",
  );
});
