/**
 * PublicQuoteView — client-side loader for the public Quote + Agreement page.
 *
 * The route used to `await` the backend in SSR, so the browser saw a blank
 * white screen until the first byte (problems.md #25). This island renders a
 * skeleton immediately, then fetches `/quotes/:id/public` through the
 * same-origin /api proxy and swaps in the real document (or an error card).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ErrorCard,
  QuoteDoc,
  type QuotePublic,
} from "../components/quote-doc.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  type PublicQuoteError,
  publicQuoteErrorKey,
  publicQuoteErrorOf,
} from "../../shared/quote-flow/public-quote-error.ts";
import { langSignal, persistLang, writeLangToUrl } from "../lib/lang.ts";
import { contractLangOnLoad } from "../../shared/quote-flow/public-lang.ts"; // REQ-715
import { startPublicQuoteRefresh } from "../lib/live-doc-refresh.ts";
import { enterSignInPerson } from "../lib/sign-in-person.ts";

interface State {
  phase: "loading" | "error" | "ok";
  quote?: QuotePublic;
  /** REQ-574: what went wrong — rendered in the current language. */
  error?: PublicQuoteError;
}

export default function PublicQuoteView(
  { id, lang: initialLang, errorLang, chosen }: {
    id: string;
    /** REQ-048: the language the contract OPENS in — English unless the
     *  visitor picked otherwise (resolveContractLang in the /q route). The
     *  EN | ES toggle below flips it in place from there. */
    lang: Lang;
    /** REQ-715 (demo-loop cycle 5, m31): the visitor chose that language —
     *  ?lang= on the link or their pm_lang pick (contractLangChosen in the
     *  route). When they did not, the contract opens in the customer's own
     *  language once the quote is loaded. */
    chosen?: boolean;
    /** REQ-574 (demo-loop c4, p4-p9b): with no document there is no doc
     *  language, so a load error speaks the visitor's own language — ?lang=,
     *  then pm_lang, then Accept-Language (resolvePublicLang in the route) —
     *  until they flip the toggle. Defaults to `lang`. */
    errorLang?: Lang;
  },
) {
  const [lang, setLang] = useState<Lang>(initialLang);
  // REQ-574: true once the visitor taps EN | ES — their pick then wins.
  const [picked, setPicked] = useState(false);
  const [s, setS] = useState<State>({ phase: "loading" });
  // REQ-306: the page's query — `?as=customer&confirm=1` is the in-person
  // override that shows the pad to the business's own viewer. Read on the
  // client only (SSR has no location); the document re-renders once set.
  const [search, setSearch] = useState<string>("");
  useEffect(() => {
    try {
      setSearch(globalThis.location?.search ?? "");
    } catch { /* SSR-safe */ }
  }, []);

  // REQ-048: one tap flips the whole document — no reload — and the pick is
  // remembered (cookie + localStorage) and mirrored into ?lang= so the link
  // stays shareable; <html lang> (HtmlLang) and the tab title follow.
  function pick(next: Lang) {
    setPicked(true);
    if (next === lang) return;
    setLang(next);
    persistLang(next);
    writeLangToUrl(next);
    // REQ-405 (demo m14): keep the view's query in step with the ?lang= just
    // written, so nothing built from `search` carries the pre-toggle query.
    try {
      setSearch(globalThis.location?.search ?? "");
    } catch { /* SSR-safe */ }
    langSignal.value = next;
    if (typeof document !== "undefined") {
      document.title = tFor(next, "quoteDoc.docTitle");
    }
  }
  // REQ-574: the toggle marks the language actually shown (an error card can
  // speak errorLang before the visitor picks).
  const toggleFor = (shown: Lang) => (
    <div
      class="ctr__lang ctr__no-print"
      role="group"
      aria-label={tFor(shown, "quoteDoc.langToggleAria")}
    >
      {(["en", "es"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          data-contract-lang={l}
          aria-pressed={shown === l ? "true" : "false"}
          class={shown === l ? "on" : ""}
          onClick={() => pick(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
  const toggle = toggleFor(lang);

  // REQ-715 (demo-loop cycle 5, m31): a visitor who chose no language (no
  // ?lang=, no pm_lang pick, no tap yet) reads the contract in the language
  // the contractor recorded for this customer, once the quote is in — before
  // it paints, so English never flashes. Not remembered as the visitor's own
  // pick: no cookie, no ?lang= written.
  const docLang = s.phase === "ok" ? s.quote?.docLang : undefined;
  useLayoutEffect(() => {
    if (picked) return;
    const next = contractLangOnLoad({
      opened: lang,
      chosen: chosen === true,
      docLang,
    });
    if (next === lang) return;
    setLang(next);
    langSignal.value = next;
    if (typeof document !== "undefined") {
      document.title = tFor(next, "quoteDoc.docTitle");
    }
  }, [docLang]);

  useEffect(() => {
    let alive = true;
    load(() => alive);
    return () => {
      alive = false;
    };
  }, [id]);

  // REQ-396 (demo-loop c2 M13): the projection used to be read once, so a
  // tab left open kept its pad after the quote was signed on another device
  // and never saw a published revision. Re-read it every 10 s (REQ-221's
  // scheduler; `?refresh=1` records no open) and swap the fresh projection
  // in place the moment its view (open / signed / declined, issued, version)
  // differs from the one shown — the baseline is read at every tick, so this
  // tab's own signature (onSigned's reload) never counts as a move.
  const shownRef = useRef<State>(s);
  shownRef.current = s;
  useEffect(
    () =>
      startPublicQuoteRefresh<QuotePublic>({
        quoteId: id,
        shown: () => shownRef.current.quote ?? null,
        onMoved: (fresh) => setS({ phase: "ok", quote: fresh }),
      }),
    [id],
  );

  function load(alive: () => boolean) {
    fetch(`/api/quotes/${id}/public`, {
      headers: { accept: "application/json" },
    })
      .then(async (r) => {
        if (!alive()) return;
        if (r.ok) {
          setS({ phase: "ok", quote: (await r.json()) as QuotePublic });
        } else {
          // REQ-574 (p4-p9b): 404 → can't find it; 410 → expired/revoked;
          // 5xx → couldn't load (retry). Not one "expired" for everything.
          await r.body?.cancel().catch(() => {});
          setS({ phase: "error", error: publicQuoteErrorOf(r.status) });
        }
      })
      .catch(() => {
        if (alive()) setS({ phase: "error", error: publicQuoteErrorOf(null) });
      });
  }

  // REQ-405 (demo-loop c2 m14): "Sign in person" — the override is laid onto
  // the CURRENT query (lang kept) with replaceState, `search` flips the
  // preview to the pad in place, and once it renders the pad is scrolled into
  // view. No navigation: no reload, no jump to the top.
  const [scrollToPad, setScrollToPad] = useState(false);
  function onSignInPerson() {
    setSearch(enterSignInPerson());
    setScrollToPad(true);
  }
  useEffect(() => {
    if (!scrollToPad) return;
    setScrollToPad(false);
    try {
      document.querySelector("form.ctr__sign-form")?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    } catch { /* noop */ }
  }, [scrollToPad]);

  // REQ-311 (demo-loop c1 m19): the signature ceremony hands its success up
  // here; we refetch the projection (now accepted, with the invoice the
  // signature billed) and swap the signed document in place — no reload, so
  // the page never jumps to the top away from the next step.
  function onSigned() {
    load(() => true);
  }

  if (s.phase === "ok" && s.quote) {
    return (
      <>
        {toggle}
        <QuoteDoc
          quote={s.quote}
          lang={lang}
          onSigned={onSigned}
          search={search}
          onSignInPerson={onSignInPerson}
        />
      </>
    );
  }
  if (s.phase === "error") {
    const errLang = picked ? lang : (errorLang ?? lang);
    return (
      <>
        {toggleFor(errLang)}
        <ErrorCard
          message={s.error
            ? tFor(errLang, publicQuoteErrorKey(s.error))
            : tFor(errLang, "publicQuote.unavailable")}
          lang={errLang}
          onRetry={s.error === "loadFailed"
            ? () => {
              setS({ phase: "loading" });
              load(() => true);
            }
            : undefined}
        />
      </>
    );
  }
  return (
    <>
      {toggle}
      <LoadingSkeleton />
    </>
  );
}

/** Lightweight placeholder shown while the agreement loads — mirrors the
 *  document card's shape so the swap-in isn't jarring. */
function LoadingSkeleton() {
  return (
    <>
      <style>
        {`@keyframes ctr-skel { 0%,100% { opacity:.55 } 50% { opacity:.85 } }`}
      </style>
      <div style="text-align:center;margin-bottom:18px">
        <div style="display:inline-block;height:11px;width:160px;border-radius:6px;background:#e3e8e6;animation:ctr-skel 1.2s ease-in-out infinite" />
      </div>
      <div style="background:#fffdf7;border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(20,72,82,0.10)">
        <div style="height:8px;background:linear-gradient(90deg,#144852 0%,#0e333b 100%)" />
        <div style="padding:36px 44px 40px;display:flex;flex-direction:column;gap:18px">
          {[220, 320, 140, 280, 200].map((w, i) => (
            <div
              key={i}
              style={`height:18px;width:${w}px;max-width:100%;border-radius:8px;background:#e9edeb;animation:ctr-skel 1.2s ease-in-out infinite;animation-delay:${
                i * 0.08
              }s`}
            />
          ))}
          <div style="margin-top:8px;height:120px;border-radius:14px;background:#eef2f0;animation:ctr-skel 1.2s ease-in-out infinite" />
        </div>
      </div>
    </>
  );
}
