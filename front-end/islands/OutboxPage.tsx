/**
 * REQ-784 — /messages, the Outbox (demo-loop cycle dv1, issue d12; Raphael:
 * "And yes to a sent message outbox."; cycle 1 m33: "/messages redirects to
 * /assistant; no way to check what was sent or in which language").
 *
 * Every email and text that went, or was meant to go, to a customer, newest
 * first (clients/outbox.ts → GET /api/outbox). A row opens the message as it
 * was sent (GET /api/outbox/:id) in a dialog; `?open=<id>` deep-links one.
 * The views are components/OutboxView.tsx.
 */
import { useEffect, useState } from "preact/hooks";
import Backdrop from "../components/Backdrop.tsx";
import { OutboxDetail, OutboxTable } from "../components/OutboxView.tsx";
import {
  outboxClient,
  type OutboxMessage,
  type OutboxRow,
} from "../clients/outbox.ts";
import { langSignal, t } from "../lib/i18n.ts";

/** Keep `?open=` in the address bar, so a reload or a shared link reopens it. */
function syncOpenParam(id: string | null) {
  try {
    const url = new URL(globalThis.location.href);
    if (id) url.searchParams.set("open", id);
    else url.searchParams.delete("open");
    globalThis.history.replaceState(null, "", url.toString());
  } catch { /* no history (SSR) — the dialog still opens */ }
}

export default function OutboxPage() {
  const lang = langSignal.value;
  const [rows, setRows] = useState<OutboxRow[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get("open");
  });
  const [opened, setOpened] = useState<OutboxMessage | null>(null);
  const [openErr, setOpenErr] = useState(false);

  useEffect(() => {
    let alive = true;
    outboxClient.list().then((list) => {
      if (alive) setRows(Array.isArray(list) ? list : []);
    }).catch(() => {
      if (!alive) return;
      setLoadErr(true);
      setRows([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setOpened(null);
    setOpenErr(false);
    if (!openId) return;
    syncOpenParam(openId);
    let alive = true;
    outboxClient.get(openId).then((m) => {
      if (alive) setOpened(m);
    }).catch(() => {
      if (alive) setOpenErr(true);
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  function close() {
    setOpenId(null);
    syncOpenParam(null);
  }

  return (
    <>
      <div class="field-head">
        <div>
          <div class="field-eyebrow">{t("outbox.eyebrow")}</div>
          <h1 data-cy="outbox-title">{t("outbox.title")}</h1>
          <p>{t("outbox.sub")}</p>
        </div>
      </div>

      {loadErr && (
        <p class="alert" data-cy="outbox-load-error">{t("outbox.error")}</p>
      )}

      <div class="panel">
        <div class="panel__title">
          {t("outbox.listTitle")}
          <span class="count" data-cy="outbox-count">{rows?.length ?? 0}</span>
        </div>
        {rows === null
          ? (
            <div class="hint" style="padding:12px 4px" data-cy="outbox-loading">
              {t("outbox.loading")}
            </div>
          )
          : rows.length === 0
          ? (
            <div class="hint" style="padding:12px 4px" data-cy="outbox-empty">
              {t("outbox.empty")}
            </div>
          )
          : <OutboxTable rows={rows} lang={lang} onOpen={setOpenId} />}
      </div>

      {openId && (
        <Backdrop class="modal-bg" onClose={close}>
          <div
            class="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="outbox-detail-title"
            data-cy="outbox-dialog"
            style="max-width:820px"
            onClick={(e) => e.stopPropagation()}
          >
            {opened ? <OutboxDetail message={opened} lang={lang} /> : (
              <p
                class={openErr ? "alert" : "hint"}
                id="outbox-detail-title"
                data-cy={openErr ? "outbox-open-error" : "outbox-opening"}
              >
                {openErr ? t("outbox.error") : t("outbox.loading")}
              </p>
            )}
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                data-cy="outbox-detail-close"
                onClick={close}
              >
                {t("outbox.detail.close")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
    </>
  );
}
