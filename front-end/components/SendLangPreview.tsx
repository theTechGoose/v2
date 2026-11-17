import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { quotesClient } from "../clients/quotes.ts";
import { fitFrameToContent } from "../lib/email-frame-fit.ts";
import {
  type QuoteSendPreview,
  type SendPreviewChannel,
  sendPreviewSections,
  sendPreviewSmsTo,
} from "../../shared/quote-flow/send-preview.ts";

/** Endonyms — the same in every UI language. */
const LANG_LABEL_KEYS: Record<string, string> = {
  en: "asstChat.previewLang.en",
  es: "asstChat.previewLang.es",
};

type SendLang = "en" | "es";

interface Props {
  /** The quote being sent; without one (or `load`) the preview can't load. */
  quoteId?: string;
  /** REQ-727: another document's preview (the invoice send sheet's GET
   *  /invoices/:id/send-preview) in place of the quote's. */
  load?: (
    channel: SendPreviewChannel,
    lang: SendLang,
  ) => Promise<QuoteSendPreview>;
  /** REQ-727: changes when what `load` previews changes (it is re-read). */
  loadKey?: string;
  channel: SendPreviewChannel;
  /** The language the Send goes out in (the review card's previewLang). */
  sendLang: SendLang;
  /** The contractor's send languages (Settings), app language first. */
  langs: string[];
  /** The dialog's own copy follows the app language. */
  uiLang: Lang;
  onPickLang: (lang: SendLang) => void;
}

/**
 * REQ-461 (demo-loop cycle 3, m8) — the send dialog names the language the
 * quote goes out in ("Sends in: English | Español", the same previewLang the
 * Send uses) and, collapsed, "What they'll get": the real email subject +
 * body and text, rendered by GET /quotes/:id/send-preview. Loads only when
 * opened, and again when the channel or language changes while open.
 */
export default function SendLangPreview(
  { quoteId, load, loadKey, channel, sendLang, langs, uiLang, onPickLang }:
    Props,
) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<QuoteSendPreview | undefined>();
  const [failed, setFailed] = useState(false);
  const choices = langs.filter((l) => l in LANG_LABEL_KEYS);
  // the latest loader, read when the preview opens (an inline arrow is a new
  // function every render — it can't be an effect dependency)
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fetchPreview = loadRef.current ??
      (quoteId
        ? (ch: SendPreviewChannel, l: SendLang) =>
          quotesClient.sendPreview(quoteId, ch, l)
        : undefined);
    if (!open || !fetchPreview) return;
    let live = true;
    setPreview(undefined);
    setFailed(false);
    fetchPreview(channel, sendLang)
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, quoteId, loadKey, channel, sendLang]);

  return (
    <div class="send-dialog__preview-wrap">
      <div class="send-dialog__lang" role="group" data-cy="send-lang">
        <span class="send-dialog__lang-label">
          {tFor(uiLang, "asstChat.send.sendsIn")}
        </span>
        {choices.map((l) => (
          <button
            key={l}
            type="button"
            class={`quote-review__langpill${
              sendLang === l ? " is-active" : ""
            }`}
            aria-pressed={sendLang === l ? "true" : "false"}
            data-cy={`send-lang-${l}`}
            onClick={() => onPickLang(l as SendLang)}
          >
            {tFor(uiLang, LANG_LABEL_KEYS[l])}
          </button>
        ))}
      </div>
      <details
        class="send-dialog__preview"
        data-cy="send-preview"
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{tFor(uiLang, "asstChat.send.whatTheyGet")}</summary>
        {open
          ? failed
            ? (
              <p class="send-dialog__preview-note">
                {tFor(uiLang, "asstChat.send.previewFailed")}
              </p>
            )
            : preview
            ? (
              <SendPreviewBody
                preview={preview}
                channel={channel}
                uiLang={uiLang}
              />
            )
            : (
              <p class="send-dialog__preview-note">
                {tFor(uiLang, "asstChat.send.previewLoading")}
              </p>
            )
          : null}
      </details>
    </div>
  );
}

/**
 * REQ-819 (demo-loop cycle dm1, M3) — the email, as tall as it is: no scroller of its own, so
 * the dialog's scroll (which the demo mirror carries) is what moves, and the pointer over it is
 * the page's (`pointer-events: none` in the CSS). Same-origin so the page can measure it; never
 * allow-scripts, so nothing in it runs. Re-fitted on every load (a new srcdoc: the language
 * switch) and when its width changes (the email re-wraps).
 */
function EmailFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const fit = () => fitFrameToContent(f);
    f.addEventListener("load", fit);
    fit(); // the srcdoc may have loaded before this effect ran
    const RO = f.ownerDocument.defaultView?.ResizeObserver;
    let width = f.clientWidth;
    const ro = RO
      ? new RO(() => {
        if (f.clientWidth === width) return; // its own height change: nothing to do
        width = f.clientWidth;
        fit();
      })
      : null;
    ro?.observe(f);
    return () => {
      f.removeEventListener("load", fit);
      ro?.disconnect();
    };
  }, []);
  return (
    <iframe
      ref={ref}
      class="send-dialog__preview-frame"
      data-cy="send-preview-email"
      title={title}
      sandbox="allow-same-origin"
      scrolling="no"
      srcdoc={html}
    />
  );
}

/** The rendered parts, per channel: the subject and the email itself (a
 *  sandboxed frame — the same HTML the customer's inbox gets), then the text. */
export function SendPreviewBody(
  { preview, channel, uiLang }: {
    preview: QuoteSendPreview;
    channel: SendPreviewChannel;
    uiLang: Lang;
  },
) {
  if (preview.needsName) {
    return (
      <p class="send-dialog__preview-note">
        {tFor(uiLang, "asstChat.send.previewNeedsName")}
      </p>
    );
  }
  const want = sendPreviewSections(channel);
  return (
    <div class="send-dialog__preview-body" lang={preview.lang}>
      {want.email && preview.email
        ? (
          <section class="send-dialog__preview-part">
            <h5>
              {tFor(uiLang, "asstChat.send.previewEmail")}
              {preview.email.to ? ` · ${preview.email.to}` : ""}
            </h5>
            <p class="send-dialog__preview-subject">
              <span>{tFor(uiLang, "asstChat.send.previewSubject")}:</span>{" "}
              <strong data-cy="send-preview-subject">
                {preview.email.subject}
              </strong>
            </p>
            <EmailFrame
              html={preview.email.html}
              title={preview.email.subject}
            />
          </section>
        )
        : null}
      {want.sms && preview.sms
        ? (
          <section class="send-dialog__preview-part">
            <h5>
              {tFor(uiLang, "asstChat.send.previewText")}
              {sendPreviewSmsTo(preview)
                ? ` · ${sendPreviewSmsTo(preview)}`
                : ""}
            </h5>
            <p class="send-dialog__preview-sms" data-cy="send-preview-sms">
              {preview.sms.body}
            </p>
          </section>
        )
        : null}
    </div>
  );
}
