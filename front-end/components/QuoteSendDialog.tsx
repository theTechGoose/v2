/**
 * REQ-570 (demo-loop cycle 4, issue m41) — the send dialog on the /quotes
 * open panel.
 *
 * The same "How do you want to send this to {name}?" dialog the assistant's
 * quote review opens (REQ-035/037/308/399/402/461), on the same rules from
 * lib/send-dialog.ts: Recommended / "needs an email" tags per channel, the
 * missing contact asked for inline and saved to the customer, its format
 * checked first, one Send in flight, "Sends in" + "What they'll get". Its
 * Send goes through sendFromQuotePanel → assistantClient.sendQuoteFlow —
 * the chat's SendQuote, on the quote's own thread.
 *
 * Rendered by the QuotesPage island (hooks are fine here).
 */
import { useRef, useState } from "preact/hooks";
import Backdrop from "./Backdrop.tsx";
import SendLangPreview from "./SendLangPreview.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import { assistantClient } from "../clients/assistant.ts";
import { clientsClient } from "../clients/clients.ts";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import {
  addFieldLabelKey,
  channelNeedsKey,
  contactSaveErrorKey,
  defaultSendLang,
  newSendRequestId,
  recommendedChannel,
  runExclusive,
  type SendChannel,
  sendDialogErrorKey,
} from "../lib/send-dialog.ts";
import {
  type PanelSendResult,
  sendFromQuotePanel,
} from "../lib/quote-panel-send.ts";

export interface SendDialogCustomer {
  id?: string;
  name?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  /** REQ-715 (demo-loop cycle 5, m31): the language the customer reads */
  language?: string | null;
}

const CHANNELS = [
  ["both", "asstChat.preview.menuBoth", ICN.send],
  ["sms", "asstChat.preview.menuSms", ICN.phone],
  ["email", "asstChat.preview.menuEmail", ICN.mail],
] as const;

export default function QuoteSendDialog(
  { lang, quoteId, customer, initialChannel, onClose, onSent }: {
    lang: Lang;
    quoteId: string;
    customer: SendDialogCustomer | null;
    initialChannel: SendChannel;
    onClose: () => void;
    onSent: (r: PanelSendResult) => void;
  },
) {
  const [channel, setChannel] = useState<SendChannel>(initialChannel);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  // REQ-715 (demo-loop cycle 5, m31): "Sends in" starts on the customer's
  // own language, else the app language
  const [sendLang, setSendLang] = useState<"en" | "es">(
    defaultSendLang(customer, lang),
  );
  const inFlight = useRef(false);
  const onFile = {
    email: customer?.email ?? undefined,
    phoneNumber: customer?.phoneNumber ?? undefined,
  };

  function send() {
    return runExclusive(inFlight, async () => {
      const typed = { email: email.trim(), phone: phone.trim() };
      const invalid = sendDialogErrorKey(channel, onFile, typed);
      if (invalid) {
        setErr(tFor(lang, invalid));
        return;
      }
      setErr(undefined);
      setSending(true);
      try {
        const needsEmail = channel !== "sms" && !onFile.email;
        const needsPhone = channel !== "email" && !onFile.phoneNumber;
        const patch: Record<string, unknown> = {
          ...(needsEmail && typed.email ? { email: typed.email } : {}),
          ...(needsPhone && typed.phone ? { phoneNumber: typed.phone } : {}),
        };
        if (customer?.id && Object.keys(patch).length) {
          try {
            await clientsClient.update(customer.id, patch);
          } catch (e) {
            setErr(tFor(lang, contactSaveErrorKey(e)));
            return;
          }
        }
        const result = await sendFromQuotePanel({
          quoteId,
          customerId: customer?.id,
          channel,
          language: sendLang,
          requestId: newSendRequestId(),
        }, {
          list: () => assistantClient.conversations(200),
          start: (body) => assistantClient.startConversation(body),
          send: (convId, qId, ch, l, rid) =>
            assistantClient.sendQuoteFlow(convId, qId, ch, l, rid),
        });
        onSent(result);
      } catch {
        setErr(tFor(lang, "quotesPage.open.sendError"));
      } finally {
        setSending(false);
      }
    });
  }

  return (
    <Backdrop class="send-dialog__backdrop" onClose={onClose}>
      <div
        class="send-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qopen-send-title"
        data-cy="send-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 id="qopen-send-title" class="send-dialog__title">
          {customer?.name
            ? tFor(lang, "asstChat.send.howTitle", { name: customer.name })
            : tFor(lang, "asstChat.send.howTitleNoName")}
        </h4>
        <div class="send-dialog__options" role="radiogroup">
          {CHANNELS.map(([ch, key, icon]) => {
            const needs = channelNeedsKey(ch, onFile);
            return (
              <button
                key={ch}
                type="button"
                role="radio"
                aria-checked={channel === ch ? "true" : "false"}
                data-cy={`send-option-${ch}`}
                class={`send-dialog__option${
                  channel === ch ? " is-current" : ""
                }`}
                onClick={() => setChannel(ch)}
              >
                <I d={icon} size={13} sw={2.4} />
                <span>{tFor(lang, key)}</span>
                {needs
                  ? (
                    <span
                      class="send-dialog__needs"
                      data-cy={`send-needs-${ch}`}
                    >
                      {tFor(lang, needs)}
                    </span>
                  )
                  : null}
                {ch === recommendedChannel(onFile)
                  ? (
                    <span class="quote-review__send-menu-tag">
                      {tFor(lang, "asstChat.preview.recommended")}
                    </span>
                  )
                  : null}
              </button>
            );
          })}
        </div>
        <SendLangPreview
          quoteId={quoteId}
          channel={channel}
          sendLang={sendLang}
          langs={lang === "es" ? ["es", "en"] : ["en", "es"]}
          uiLang={lang}
          onPickLang={setSendLang}
        />
        {channel !== "sms" && !onFile.email
          ? (
            <label class="send-dialog__add" data-cy="send-add-email">
              <span>{tFor(lang, addFieldLabelKey("email", channel))}</span>
              <input
                type="email"
                class="cust-pick__search"
                placeholder={tFor(lang, "asstChat.send.emailPlaceholder")}
                value={email}
                onInput={(e) =>
                  setEmail((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          )
          : null}
        {channel !== "email" && !onFile.phoneNumber
          ? (
            <label class="send-dialog__add" data-cy="send-add-phone">
              <span>{tFor(lang, addFieldLabelKey("phone", channel))}</span>
              <input
                type="tel"
                class="cust-pick__search"
                placeholder={tFor(
                  lang,
                  "asstChat.customerStep.phonePlaceholder",
                )}
                value={formatPhoneInput(phone)}
                onInput={(e) =>
                  setPhone((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          )
          : null}
        {err ? <div class="cust-pick__err">{err}</div> : null}
        <div class="send-dialog__actions">
          <button
            type="button"
            class="send-dialog__cancel"
            data-cy="send-cancel"
            onClick={onClose}
          >
            {tFor(lang, "asstChat.send.cancel")}
          </button>
          <button
            type="button"
            class="send-dialog__keep"
            data-cy="send-keep"
            disabled={sending}
            onClick={() => void send()}
          >
            {sending
              ? tFor(lang, "asstChat.preview.sending")
              : tFor(lang, "asstChat.send.keep")}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
