/**
 * REQ-784 — the Outbox page's two views (demo-loop cycle dv1, issue d12;
 * Raphael: "And yes to a sent message outbox."):
 *
 *  - OutboxTable: every email and text to a customer — when, the customer,
 *    the channel, the language it went out in, the document, the subject or
 *    first line, and sent / not sent and why;
 *  - OutboxDetail: one message opened — the email exactly as rendered, in a
 *    fully sandboxed frame (no scripts, no navigation, no same-origin), the
 *    text's words, or why it didn't go.
 *
 * Presentational and language-explicit (`lang`), so the island and the
 * render tests (lib/outbox.test.tsx) share them.
 */
import { Fragment } from "preact";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  outboxChannelLabel,
  outboxLanguageLabel,
  type OutboxMessage,
  type OutboxRow,
  outboxStatusLabel,
  outboxWhat,
  outboxWhen,
  outboxWhy,
} from "../lib/outbox.ts";

export function OutboxTable(
  { rows, lang, onOpen }: {
    rows: OutboxRow[];
    lang: Lang;
    onOpen: (id: string) => void;
  },
) {
  const t = (key: string) => tFor(lang, key);
  return (
    <div style="overflow-x:auto">
      <table class="table" data-cy="outbox-table">
        <thead>
          <tr>
            <th>{t("outbox.col.when")}</th>
            <th>{t("outbox.col.customer")}</th>
            <th>{t("outbox.col.channel")}</th>
            <th>{t("outbox.col.language")}</th>
            <th>{t("outbox.col.what")}</th>
            <th>{t("outbox.col.message")}</th>
            <th>{t("outbox.col.status")}</th>
            <th aria-label={t("outbox.open")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const why = outboxWhy(r, lang);
            return (
              <tr
                key={r.id}
                data-cy="outbox-row"
                data-id={r.id}
                data-status={r.status}
                style="cursor:pointer"
                onClick={() => onOpen(r.id)}
              >
                <td data-cy="outbox-row-when" style="white-space:nowrap">
                  {outboxWhen(r.createdAt, lang)}
                </td>
                <td data-cy="outbox-row-customer" style="font-weight:700">
                  {r.customerName || "—"}
                </td>
                <td data-cy="outbox-row-channel">
                  {outboxChannelLabel(r.channel, lang)}
                </td>
                <td data-cy="outbox-row-language">
                  {outboxLanguageLabel(r.language, lang)}
                </td>
                <td data-cy="outbox-row-what" style="white-space:nowrap">
                  {outboxWhat(r, lang)}
                </td>
                <td
                  data-cy="outbox-row-message"
                  style="max-width:320px;color:var(--fg)"
                >
                  {r.preview || "—"}
                </td>
                <td data-cy="outbox-row-status" style="min-width:150px">
                  <span
                    class={r.status === "sent"
                      ? "chip chip--green"
                      : "chip chip--pink"}
                  >
                    {outboxStatusLabel(r, lang)}
                  </span>
                  {why && (
                    <div
                      class="hint"
                      data-cy="outbox-row-why"
                      style="margin-top:4px;max-width:260px"
                    >
                      {why}
                    </div>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn--sm"
                    data-cy="outbox-open"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r.id);
                    }}
                  >
                    {t("outbox.open")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OutboxDetail(
  { message, lang }: { message: OutboxMessage; lang: Lang },
) {
  const t = (key: string, vars?: Record<string, string>) =>
    tFor(lang, key, vars);
  const why = outboxWhy(message, lang);
  const status = outboxStatusLabel(message, lang);
  const who = message.customerName || message.to || "—";
  const title = message.channel === "email"
    ? message.subject || t("outbox.detail.emailTitle", { name: who })
    : t("outbox.detail.textTitle", { name: who });
  const facts: [string, string, string][] = [
    [
      "to",
      t("outbox.detail.to"),
      [message.customerName, message.to].filter(Boolean).join(" · ") || "—",
    ],
    ["when", t("outbox.col.when"), outboxWhen(message.createdAt, lang)],
    [
      "channel",
      t("outbox.col.channel"),
      outboxChannelLabel(message.channel, lang),
    ],
    [
      "language",
      t("outbox.col.language"),
      outboxLanguageLabel(message.language, lang),
    ],
    ["what", t("outbox.col.what"), outboxWhat(message, lang)],
    ["status", t("outbox.col.status"), status],
  ];
  const went = message.status === "sent" && message.body !== "";
  return (
    <div
      data-cy="outbox-detail"
      style="display:flex;flex-direction:column;gap:12px"
    >
      <h2 id="outbox-detail-title" data-cy="outbox-detail-title">{title}</h2>
      <dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0;font-size:13.5px">
        {facts.map(([cy, label, value]) => (
          <Fragment key={cy}>
            <dt style="color:var(--fg-muted);font-weight:700">{label}</dt>
            <dd
              data-cy={`outbox-detail-${cy}`}
              style="margin:0;color:var(--fg)"
            >
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
      {why && (
        <p class="alert" data-cy="outbox-detail-why" style="margin:0">
          {t("outbox.detail.why", { status, why })}
        </p>
      )}
      {went && message.channel === "email" && (
        <>
          <div class="hint">{t("outbox.detail.asSent")}</div>
          <iframe
            data-cy="outbox-email-frame"
            title={t("outbox.detail.frameTitle")}
            sandbox=""
            srcdoc={message.body}
            style="width:100%;height:min(62vh,640px);border:1px solid var(--border);border-radius:12px;background:#fff"
          />
        </>
      )}
      {went && message.channel === "text" && (
        <>
          <div class="hint">{t("outbox.detail.asSent")}</div>
          <div
            data-cy="outbox-text-body"
            style="white-space:pre-wrap;overflow-wrap:anywhere;background:var(--mint-200);color:var(--fg);border-radius:16px 16px 16px 4px;padding:12px 14px;font-size:14.5px;line-height:1.45;max-width:440px"
          >
            {message.body}
          </div>
        </>
      )}
      {!went && (
        <p class="hint" data-cy="outbox-detail-nothing" style="margin:0">
          {t("outbox.detail.nothingSent")}
        </p>
      )}
    </div>
  );
}
