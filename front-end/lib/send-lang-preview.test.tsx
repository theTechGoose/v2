/**
 * REQ-461 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 3, issue m8: the send dialog names the send language and
 * shows what the client gets. SendLangPreview is rendered for real (SSR).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import SendLangPreview, {
  SendPreviewBody,
} from "../components/SendLangPreview.tsx";

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")!;

Deno.test("REQ-461 (m8) the dialog says 'Sends in' with a pill per send language, the send language pressed", () => {
  const doc = parse(renderToString(
    <SendLangPreview
      quoteId="q-1"
      channel="both"
      sendLang="es"
      langs={["en", "es"]}
      uiLang="en"
      onPickLang={() => {}}
    />,
  ));
  const group = doc.querySelector('[data-cy="send-lang"]');
  assert(group, "send-lang group rendered");
  assertStringIncludes(group.textContent, "Sends in");
  const pills = group.querySelectorAll("button");
  assertEquals(pills.length, 2);
  assertEquals(pills[0].textContent.trim(), "English");
  assertEquals(pills[0].getAttribute("aria-pressed"), "false");
  assertEquals(pills[1].textContent.trim(), "Español");
  assertEquals(pills[1].getAttribute("aria-pressed"), "true");
  // collapsed by default
  const details = doc.querySelector('[data-cy="send-preview"]');
  assert(details, "what-they-get disclosure rendered");
  assertEquals(details.tagName, "DETAILS");
  assertEquals(details.hasAttribute("open"), false);
  assertStringIncludes(
    details.querySelector("summary")!.textContent,
    "What they'll get",
  );
});

Deno.test("REQ-461 (m8) one send language still names it", () => {
  const doc = parse(renderToString(
    <SendLangPreview
      quoteId="q-1"
      channel="sms"
      sendLang="en"
      langs={["en"]}
      uiLang="es"
      onPickLang={() => {}}
    />,
  ));
  const group = doc.querySelector('[data-cy="send-lang"]')!;
  assertStringIncludes(group.textContent, "Se envía en");
  assertStringIncludes(group.textContent, "English");
});

Deno.test("REQ-461 (m8) the preview body shows the subject, the email in a sandboxed frame, and the text — per channel", () => {
  const preview = {
    lang: "es" as const,
    email: {
      to: "juan@example.com",
      subject: "Cotización Q-001 de Diaz",
      html: "<html><body>Hola</body></html>",
    },
    sms: {
      to: "+15125551234",
      body: "Hola Juan, tu cotización está lista: https://x/s/abc?lang=es",
    },
  };
  const both = parse(
    renderToString(
      <SendPreviewBody preview={preview} channel="both" uiLang="en" />,
    ),
  );
  assertStringIncludes(
    both.querySelector('[data-cy="send-preview-subject"]')!.textContent,
    "Cotización Q-001 de Diaz",
  );
  const frame = both.querySelector('[data-cy="send-preview-email"]')!;
  assertEquals(frame.tagName, "IFRAME");
  assertEquals(frame.getAttribute("sandbox"), "");
  assertStringIncludes(frame.getAttribute("srcdoc") ?? "", "Hola");
  assertStringIncludes(
    both.querySelector('[data-cy="send-preview-sms"]')!.textContent,
    "?lang=es",
  );

  const smsOnly = parse(
    renderToString(
      <SendPreviewBody preview={preview} channel="sms" uiLang="en" />,
    ),
  );
  assertEquals(smsOnly.querySelector('[data-cy="send-preview-email"]'), null);
  assert(smsOnly.querySelector('[data-cy="send-preview-sms"]'));

  const needsName = parse(
    renderToString(
      <SendPreviewBody
        preview={{ lang: "en", needsName: true }}
        channel="both"
        uiLang="en"
      />,
    ),
  );
  assertStringIncludes(needsName.body.textContent, "Add your name");
});
