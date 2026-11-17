/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12 "A sent-messages outbox shows every email and text that
 * went to customers"; cycle 1 m33: "/messages redirects to /assistant; no
 * way to check what was sent or in which language."
 *
 * The page's two views, rendered for real in en and es: the list (when,
 * customer, channel, language, the document, subject or first line, sent /
 * not sent and why) and one opened message (the email as rendered, in a
 * sandboxed frame; the text's words; or why it didn't go). Plus the way in:
 * the sidebar's root Outbox row and the /messages route.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { OutboxDetail, OutboxTable } from "../components/OutboxView.tsx";
import {
  type OutboxMessage,
  type OutboxRow,
  outboxStatusLabel,
  outboxWhen,
  outboxWhy,
} from "./outbox.ts";
import { NAV } from "./nav-tree.ts";
import { viewAt } from "./nav-folders.ts";

const dict = (lang: "en" | "es") =>
  JSON.parse(
    Deno.readTextFileSync(new URL(`../../lang/${lang}.json`, import.meta.url)),
  ) as Record<string, string>;
const en = dict("en");
const es = dict("es");

const HTML =
  '<!doctype html><html><body><h1 style="color:#144852">Cotización Q-001</h1><p>Hola María, &quot;su&quot; cotización</p></body></html>';

const ROWS: OutboxRow[] = [
  {
    id: "o-4",
    createdAt: "2026-11-13T15:09:00.000Z",
    channel: "text",
    status: "not_sent",
    reasonCode: "fictional",
    reason: "that's a reserved test number (555-01XX or area code 555)",
    language: "es",
    kind: "quote",
    customerName: "María López",
    to: "+15125550188",
    docRef: "Q-001",
    preview: "",
  },
  {
    id: "o-3",
    createdAt: "2026-11-13T15:08:00.000Z",
    channel: "email",
    status: "sent",
    language: "es",
    kind: "quote",
    customerName: "María López",
    to: "maria@example.com",
    docRef: "Q-001",
    subject: "Cotización Q-001 de Ortega Handyman Services",
    preview: "Cotización Q-001 de Ortega Handyman Services",
  },
  {
    id: "o-2",
    createdAt: "2026-11-13T15:07:00.000Z",
    channel: "email",
    status: "sent",
    language: "es",
    kind: "changeOrder",
    customerName: "María López",
    to: "maria@example.com",
    docRef: "CO-001",
    subject: "Ortega Handyman Services te envió un cambio — CO-001 en INV-001",
    preview: "Ortega Handyman Services te envió un cambio — CO-001 en INV-001",
  },
  {
    id: "o-1",
    createdAt: "2026-11-13T15:06:00.000Z",
    channel: "text",
    status: "sent",
    language: "en",
    kind: "invoice",
    customerName: "Tom Reyes",
    to: "+15125557152",
    docRef: "INV-001",
    preview: "Hi Tom, this is Luis from Ortega Handyman Services.",
  },
];

function table(lang: "en" | "es") {
  const html = renderToString(
    <OutboxTable rows={ROWS} lang={lang} onOpen={() => {}} />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

const cell = (row: Element, cy: string) =>
  row.querySelector(`[data-cy='${cy}']`)?.textContent.trim() ?? "";

for (const lang of ["en", "es"] as const) {
  const d = lang === "en" ? en : es;

  Deno.test(`REQ-784 d12: every row says when, who, how, in which language, what it carried and whether it went (${lang})`, () => {
    const doc = table(lang);
    const heads = [...doc.querySelectorAll("thead th")].map((th) =>
      th.textContent.trim()
    );
    for (
      const k of [
        "outbox.col.when",
        "outbox.col.customer",
        "outbox.col.channel",
        "outbox.col.language",
        "outbox.col.what",
        "outbox.col.message",
        "outbox.col.status",
      ]
    ) {
      assert(d[k], `${lang} has ${k}`);
      assert(heads.includes(d[k]), `${lang} column "${d[k]}" in ${heads}`);
    }
    const rows = [...doc.querySelectorAll("[data-cy='outbox-row']")];
    assertEquals(rows.length, 4);

    const [skipped, quoteMail, coMail, invText] = rows;
    assertEquals(cell(quoteMail, "outbox-row-customer"), "María López");
    assertEquals(
      cell(quoteMail, "outbox-row-channel"),
      d["outbox.channel.email"],
    );
    assertEquals(cell(quoteMail, "outbox-row-language"), d["outbox.lang.es"]);
    assertEquals(
      cell(quoteMail, "outbox-row-what"),
      `${d["outbox.kind.quote"]} Q-001`,
    );
    assertEquals(
      cell(quoteMail, "outbox-row-message"),
      "Cotización Q-001 de Ortega Handyman Services",
    );
    assertStringIncludes(
      cell(quoteMail, "outbox-row-status"),
      d["outbox.status.sent"],
    );
    assert(cell(quoteMail, "outbox-row-when"), "the time is shown");

    assertEquals(cell(skipped, "outbox-row-channel"), d["outbox.channel.text"]);
    assertStringIncludes(
      cell(skipped, "outbox-row-status"),
      d["outbox.status.notTexted"],
    );
    assertStringIncludes(
      cell(skipped, "outbox-row-status"),
      d["outbox.why.fictional"],
    );
    assertEquals(
      cell(coMail, "outbox-row-what"),
      `${d["outbox.kind.changeOrder"]} CO-001`,
    );
    assertEquals(cell(invText, "outbox-row-language"), d["outbox.lang.en"]);
    assertEquals(
      cell(invText, "outbox-row-message"),
      "Hi Tom, this is Luis from Ortega Handyman Services.",
    );
    // every row opens its message
    for (const r of rows) {
      assert(
        r.querySelector("[data-cy='outbox-open']"),
        "a row has its Open control",
      );
    }
  });

  Deno.test(`REQ-784 d12: an opened email is shown as sent — its HTML in a sandboxed frame, with to / subject / language / status (${lang})`, () => {
    const message: OutboxMessage = { ...ROWS[1], body: HTML };
    const html = renderToString(<OutboxDetail message={message} lang={lang} />);
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    const frame = doc.querySelector("iframe[data-cy='outbox-email-frame']");
    assert(frame, "the email renders in a frame");
    assertEquals(frame.getAttribute("srcdoc"), HTML, "exactly the HTML sent");
    assertEquals(
      frame.getAttribute("sandbox"),
      "",
      "sandboxed: no scripts, no navigation, no same-origin",
    );
    const text = doc.body.textContent;
    assertStringIncludes(text, "maria@example.com");
    assertStringIncludes(text, "Cotización Q-001 de Ortega Handyman Services");
    assertStringIncludes(text, (lang === "en" ? en : es)["outbox.lang.es"]);
    assertStringIncludes(
      text,
      (lang === "en" ? en : es)["outbox.status.sent"],
    );
  });

  Deno.test(`REQ-784 d12: an opened text shows its words; one that didn't go says 'not texted' and why, with no content (${lang})`, () => {
    const d2 = lang === "en" ? en : es;
    const words =
      "Hi Tom, this is Luis from Ortega Handyman Services.\n\nYour invoice INV-001 is ready: https://x.test/s/abc";
    const sent = renderToString(
      <OutboxDetail message={{ ...ROWS[3], body: words }} lang={lang} />,
    );
    const sentDoc = new DOMParser().parseFromString(sent, "text/html")!;
    assertEquals(
      sentDoc.querySelector("[data-cy='outbox-text-body']")?.textContent,
      words,
    );
    const skipped = renderToString(
      <OutboxDetail message={{ ...ROWS[0], body: "" }} lang={lang} />,
    );
    const skippedDoc = new DOMParser().parseFromString(skipped, "text/html")!;
    assertEquals(
      skippedDoc.querySelector("[data-cy='outbox-text-body']"),
      null,
    );
    const why = skippedDoc.querySelector("[data-cy='outbox-detail-why']")
      ?.textContent ?? "";
    assertStringIncludes(why, d2["outbox.status.notTexted"]);
    assertStringIncludes(why, d2["outbox.why.fictional"]);
  });
}

Deno.test("REQ-784 d12: the status reads sent / not emailed / not texted, and the why is worded in the page's language from its code", () => {
  assertEquals(outboxStatusLabel(ROWS[1], "en"), en["outbox.status.sent"]);
  assertEquals(outboxStatusLabel(ROWS[0], "es"), es["outbox.status.notTexted"]);
  assertEquals(
    outboxStatusLabel(
      { ...ROWS[1], status: "not_sent", reasonCode: "missing" },
      "en",
    ),
    en["outbox.status.notEmailed"],
  );
  assertEquals(outboxWhy(ROWS[0], "es"), es["outbox.why.fictional"]);
  assertEquals(
    outboxWhy({ ...ROWS[1], status: "not_sent", reasonCode: "missing" }, "en"),
    en["outbox.why.missing.email"],
  );
  assertEquals(
    outboxWhy({ ...ROWS[0], reasonCode: "missing" }, "es"),
    es["outbox.why.missing.text"],
  );
  // an unknown provider refusal keeps the provider's own words
  assertStringIncludes(
    outboxWhy({
      ...ROWS[1],
      status: "not_sent",
      reasonCode: "other",
      reason: "postmark 422: Invalid 'To' address",
    }, "en") ?? "",
    "422",
  );
  assertEquals(
    outboxWhy(ROWS[1], "en"),
    undefined,
    "a sent message has no why",
  );
  // the date and the time, in the page's language
  assertStringIncludes(outboxWhen("2026-11-13T15:08:00.000Z", "en"), "2026");
  assert(/[AP]M/.test(outboxWhen("2026-11-13T15:08:00.000Z", "en")));
  assert(/[ap]\. m\./.test(outboxWhen("2026-11-13T15:08:00.000Z", "es")));
});

Deno.test("REQ-784 d12 (REQ-176 amendment): the sidebar's root has Outbox → /messages, and /messages renders the outbox instead of redirecting to the assistant", () => {
  const root = viewAt(NAV, []).items;
  const outbox = root.find((n) => n.id === "outbox");
  assert(outbox && "href" in outbox, "Outbox is a root row");
  assertEquals((outbox as { href: string }).href, "/messages");
  const route = Deno.readTextFileSync(
    new URL("../routes/messages/index.tsx", import.meta.url),
  );
  assert(!route.includes("/assistant?from=messages"), "no redirect");
  assert(/<OutboxPage\b/.test(route), "the route renders the outbox island");
  assert(
    /<DashSidebar active="outbox"/.test(route),
    "Outbox is the active row",
  );
  assert(/pageTitleKey="nav\.outbox"/.test(route), "the topbar names the page");
});

Deno.test("REQ-784 d12: every outbox.* key is in both dictionaries, and the Spanish ones are not English copies", () => {
  const keys = Object.keys(en).filter((k) =>
    k.startsWith("outbox.") || k === "nav.outbox"
  );
  assert(keys.length >= 20, `outbox keys: ${keys.length}`);
  for (const k of keys) {
    assert(es[k], `es has ${k}`);
  }
  for (const k of Object.keys(es).filter((k) => k.startsWith("outbox."))) {
    assert(en[k], `en has ${k}`);
  }
  assertEquals(en["nav.outbox"], "Outbox");
  assertEquals(es["nav.outbox"], "Bandeja de salida");
  for (const k of ["outbox.title", "outbox.status.sent", "outbox.empty"]) {
    assert(es[k] !== en[k], `${k} is translated`);
  }
});
