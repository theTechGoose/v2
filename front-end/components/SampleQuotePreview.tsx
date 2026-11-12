/**
 * SampleQuotePreview — the onboarding wizard's "See what your customer sees"
 * sample, rendered INLINE (REQ-433, demo-loop cycle 3, issue M13).
 *
 * The step used to embed the public page as <iframe src="/q/<id>">. The demo
 * stage's mirror never carries an embedded page (REQ-242: the recorder drops
 * an iframe's src, the replayer refuses it, the stage CSP is frame-src
 * 'none'), so on the stage step 10 was an empty grey box. Here the same
 * public projection (`/api/quotes/:id/public`, what PublicQuoteView reads) is
 * fetched and painted with the same QuoteDoc the /q page uses, scaled down in
 * a scrollable container — ordinary DOM the mirror records like any other.
 */
import { useEffect, useState } from "preact/hooks";
import { QuoteDoc, type QuotePublic } from "./quote-doc.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";

/** The document, scaled into the wizard card. Read-only: the scaled copy
 *  takes no pointer input (the wheel still scrolls the frame); the person
 *  opens the full page from the step's "Open full size" link. */
export function SampleQuoteDoc(
  { quote, lang }: { quote: QuotePublic; lang: Lang },
) {
  return (
    <div class="welcome__sample-doc-wrap" data-cy="welcome-sample-doc">
      <div class="welcome__sample-doc">
        <QuoteDoc quote={quote} lang={lang} />
      </div>
    </div>
  );
}

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ok"; quote: QuotePublic };

/** Fetches the sample's public projection and renders it inline; the wizard
 *  re-renders on the EN | ES toggle, and QuoteDoc picks the language's copy. */
export function SampleQuotePreview(
  { quoteId, lang }: { quoteId: string; lang: Lang },
) {
  const [s, setS] = useState<Load>({ phase: "loading" });
  useEffect(() => {
    let alive = true;
    setS({ phase: "loading" });
    fetch(`/api/quotes/${quoteId}/public`, {
      headers: { accept: "application/json" },
    })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          await r.body?.cancel();
          setS({ phase: "error" });
          return;
        }
        setS({ phase: "ok", quote: (await r.json()) as QuotePublic });
      })
      .catch(() => {
        if (alive) setS({ phase: "error" });
      });
    return () => {
      alive = false;
    };
  }, [quoteId]);

  if (s.phase === "ok") return <SampleQuoteDoc quote={s.quote} lang={lang} />;
  if (s.phase === "error") {
    return (
      <p class="welcome__error" role="alert">
        {tFor(lang, "welcome.sample.error")}
      </p>
    );
  }
  return (
    <p class="welcome__sample-loading">
      {tFor(lang, "welcome.sample.loading")}
    </p>
  );
}
