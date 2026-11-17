/**
 * REQ-405 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2, issue m14: "'Sign in person' reloads page, drops
 * scroll to top and ?lang=es".
 *
 * The override was a plain <a href={overrideHref}> built from a `search`
 * PublicQuoteView captured once on mount, so the click was a full navigation
 * (reload, back to the top) and a language picked after mount was missing
 * from the link. Now:
 * - the override query is built from the CURRENT query (lang kept);
 * - the click replaceState()s it — no navigation — and hands it back so the
 *   view re-renders the pad in place and scrolls it into view;
 * - "Sign in person" is a button, not a link;
 * - pick() keeps the view's `search` in step with the ?lang= it wrote.
 * The browser proof is e2e/sign-in-person.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";
import {
  hasSignOverride,
  signOverrideSearch,
} from "../../shared/quote-flow/public-doc-state.ts";
import { enterSignInPerson } from "./sign-in-person.ts";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

function openInternalQuote(): QuotePublic {
  return {
    id: "q-405",
    number: "Q-405",
    version: 1,
    state: "sent",
    status: "sent",
    internal: true,
    customer: { name: "Ana Pérez", email: "ana@example.com" },
    contractor: { name: "Bob Builder", businessName: "Bob's Plumbing" },
    summary: "Bathroom remodel",
    estimatedTotal: 480000,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 480000,
    }],
  } as QuotePublic;
}

Deno.test("REQ-405 (demo m14, cycle 2): the override query is built on the current query — ?lang=es survives", () => {
  const s = signOverrideSearch("?lang=es");
  const q = new URLSearchParams(s.slice(1));
  assertEquals(s.startsWith("?"), true);
  assertEquals(q.get("lang"), "es");
  assertEquals(q.get("as"), "customer");
  assertEquals(q.get("confirm"), "1");
  assert(hasSignOverride(s));
  assertEquals(signOverrideSearch(""), "?as=customer&confirm=1");
  // a half override is completed, not duplicated
  const again = new URLSearchParams(
    signOverrideSearch("?as=customer&lang=en").slice(1),
  );
  assertEquals(again.getAll("as"), ["customer"]);
  assertEquals(again.get("confirm"), "1");
  assertEquals(again.get("lang"), "en");
});

Deno.test("REQ-405 (demo m14, cycle 2): entering sign-in-person rewrites the URL in place from the CURRENT location — no navigation", () => {
  const calls: unknown[][] = [];
  let navigated = false;
  const win = {
    location: {
      href: "https://documonster.com/q/q-405?lang=es",
      search: "?lang=es",
      assign: () => {
        navigated = true;
      },
    },
    history: {
      replaceState: (...a: unknown[]) => {
        calls.push(a);
      },
    },
  };
  const next = enterSignInPerson(win);
  assertEquals(navigated, false, "no navigation");
  assertEquals(calls.length, 1, "one replaceState");
  const url = new URL(String(calls[0][2]));
  assertEquals(url.pathname, "/q/q-405");
  assertEquals(url.searchParams.get("lang"), "es");
  assertEquals(url.searchParams.get("as"), "customer");
  assertEquals(url.searchParams.get("confirm"), "1");
  assertEquals(next, url.search, "the new query is handed back to the view");
  assert(hasSignOverride(next));
});

Deno.test("REQ-405 (demo m14, cycle 2): 'Sign in person' is a button that calls back, not a link that reloads", () => {
  let called = 0;
  const html = renderToString(
    <QuoteDoc
      quote={openInternalQuote()}
      lang="es"
      search="?lang=es"
      onSignInPerson={() => called++}
    />,
  );
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  assert(doc.querySelector("[data-cy='quote-internal-preview']"), "preview");
  const el = doc.querySelector("[data-cy='quote-sign-in-person']");
  assert(el, "the sign-in-person control renders");
  assertEquals(el.tagName.toLowerCase(), "button");
  assertEquals(el.getAttribute("type"), "button");
  assertEquals(el.getAttribute("href"), null, "no href to navigate to");
  assertEquals(doc.querySelector("a[href*='confirm=1']"), null);
  assertEquals(called, 0);
});

Deno.test("REQ-405 (demo m14, cycle 2): the view swaps the pad in place, scrolls it into view, and keeps `search` in step with ?lang=", () => {
  const view = src("../islands/PublicQuoteView.tsx");
  const pick = view.slice(
    view.indexOf("function pick("),
    view.indexOf("const toggle"),
  );
  assert(
    /writeLangToUrl\(next\);[\s\S]*setSearch\(/.test(pick),
    "pick() updates `search` after writeLangToUrl",
  );
  assert(/enterSignInPerson\(/.test(view), "the click uses enterSignInPerson");
  assert(/onSignInPerson=\{/.test(view), "the view hands the callback down");
  assert(/scrollIntoView\(/.test(view), "the pad is scrolled into view");
  const doc = src("../components/quote-doc.tsx");
  assertEquals(
    /href=\{overrideHref\}/.test(doc),
    false,
    "no stale override link",
  );
});
