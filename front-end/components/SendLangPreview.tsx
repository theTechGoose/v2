import { useEffect, useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { quotesClient } from "../clients/quotes.ts";
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
  /** The quote being sent; without one the preview can't load. */
  quoteId?: string;
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
  { quoteId, channel, sendLang, langs, uiLang, onPickLang }: Props,
) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<QuoteSendPreview | undefined>();
  const [failed, setFailed] = useState(false);
  const choices = langs.filter((l) => l in LANG_LABEL_KEYS);

  useEffect(() => {
    if (!open || !quoteId) return;
    let live = true;
    setPreview(undefined);
    setFailed(false);
    quotesClient.sendPreview(quoteId, channel, sendLang)
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, quoteId, channel, sendLang]);

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
            <iframe
              class="send-dialog__preview-frame"
              data-cy="send-preview-email"
              title={preview.email.subject}
              sandbox=""
              srcdoc={preview.email.html}
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
