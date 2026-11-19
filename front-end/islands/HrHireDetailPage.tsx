/**
 * REQ-884 / REQ-885d / REQ-888 — /hr/hires/:id: the hire's file. The pipeline, the signing link
 * (copy, send, re-send — a new link once expired), what went out and when it was opened, the text
 * and email previews, the frozen packet with each document's proof (the signature image or the
 * acknowledgment, the printed name, the audit line), the accounts (each system's arm: created,
 * manual step → Mark done, failed → Retry), and Offboard. Strings: hr.detail.*, hr.proof.*.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type Hire,
  hrClient,
  type HrSettings,
  type Proof,
} from "../clients/hr.ts";
import Backdrop from "../components/Backdrop.tsx";
import {
  friendlyHr,
  Progress,
  StatusChip,
  Toast,
  useToast,
} from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { armKey, fmtDate, fmtWhen, initialsOf, inviteText } from "../lib/hr.ts";
import { langSignal, t } from "../lib/i18n.ts";

export default function HrHireDetailPage({ id }: { id: string }) {
  const lang = langSignal.value;
  const [h, setH] = useState<Hire | null>(null);
  const [settings, setSettings] = useState<HrSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<
    { proof: Proof; name: string } | null
  >(null);
  const [toast, say] = useToast();

  useEffect(() => {
    hrClient.hire(id).then(setH).catch(() => setMissing(true));
    hrClient.settings().then(setSettings).catch(() => {});
  }, [id]);

  async function act(fn: () => Promise<Hire>, done?: string) {
    setBusy(true);
    setErr(null);
    try {
      setH(await fn());
      if (done) say(done);
    } catch (e) {
      setErr(friendlyHr(e, "hr.detail"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!h) return;
    try {
      await navigator.clipboard.writeText(h.signUrl);
      say(t("hr.detail.copied"));
    } catch {
      // the clipboard is unavailable in some embeds; the link is on screen anyway
    }
  }

  async function openProof(docId: string, name: string) {
    try {
      const p = await hrClient.proof(id, docId);
      setProof({ proof: p, name });
    } catch (e) {
      setErr(friendlyHr(e, "hr.detail"));
    }
  }

  if (missing) {
    return (
      <p class="alert" data-cy="hr-detail-missing">{t("hr.detail.notFound")}</p>
    );
  }
  if (!h) return <p class="hint">{t("hr.common.loading")}</p>;

  const expired = h.status === "expired";
  const closed = h.status === "offboarded";
  const company = settings?.companyName || "";
  const canProvision = ["signed", "provisioning", "active"].includes(h.status);

  return (
    <>
      <p style="margin:0 0 10px">
        <a class="btn btn--ghost btn--sm" href="/hr/hires" data-cy="hr-back">
          <I d={ICN.back} size={14} /> {t("hr.detail.back")}
        </a>
      </p>
      <div class="hr-detail-head">
        <span class="hr-avatar hr-avatar--lg">{initialsOf(h.name)}</span>
        <div>
          <h1 data-cy="hr-detail-name">{h.name}</h1>
          <div class="hr-who__sub">
            {h.departmentName} · {t("hr.detail.start")}{" "}
            {fmtDate(h.startDate, lang)}
          </div>
        </div>
        <StatusChip status={h.status} />
        <div class="field-actions">
          {!closed && (
            <button
              type="button"
              class="btn btn--pink"
              data-cy="hr-send"
              disabled={busy}
              onClick={() => setSendOpen(true)}
            >
              <I d={ICN.send} size={14} /> {expired
                ? t("hr.detail.reissue")
                : h.mail.sentAt
                ? t("hr.detail.resend")
                : t("hr.detail.send")}
            </button>
          )}
          {!closed && (
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-cy="hr-offboard"
              disabled={busy}
              onClick={() => setOffOpen(true)}
            >
              {t("hr.detail.offboard")}
            </button>
          )}
        </div>
      </div>
      {err && <p class="alert" data-cy="hr-detail-err">{err}</p>}

      <section class="panel">
        <h2 class="panel__title">{t("hr.detail.pipeline")}</h2>
        <div class="hr-pipe" data-cy="hr-pipeline">
          {h.pipeline.map((s) => (
            <div
              key={s.key}
              class={`hr-pipe__step hr-pipe__step--${s.state}`}
              data-cy={`hr-step-${s.key}`}
              data-state={s.state}
            >
              {t(`hr.detail.step.${s.key}`)}
            </div>
          ))}
        </div>
        <dl class="hr-meta">
          <div>
            <dt>{t("hr.detail.phone")}</dt>
            <dd>{h.phone || t("hr.common.none")}</dd>
          </div>
          <div>
            <dt>{t("hr.detail.email")}</dt>
            <dd>{h.email || t("hr.common.none")}</dd>
          </div>
        </dl>
        <h2 class="panel__title">{t("hr.detail.link")}</h2>
        <div class="hr-link">
          <code data-cy="hr-sign-url">{h.signUrl}</code>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            data-cy="hr-copy"
            onClick={copy}
          >
            <I d={ICN.clip} size={14} /> {t("hr.detail.copy")}
          </button>
          <a
            class="btn btn--ghost btn--sm"
            href={h.signUrl}
            target="_blank"
            rel="noopener"
          >
            {t("hr.detail.open")}
          </a>
        </div>
        <div class="hr-mail" data-cy="hr-mail">
          <span>
            {h.mail.sentAt
              ? t("hr.detail.mail.sent", { when: fmtWhen(h.mail.sentAt, lang) })
              : t("hr.detail.mail.notSent")}
          </span>
          <span>
            {h.mail.openedAt
              ? t("hr.detail.mail.opened", {
                when: fmtWhen(h.mail.openedAt, lang),
              })
              : t("hr.detail.mail.notOpened")}
          </span>
          {h.mail.remindedAt && (
            <span>
              {t("hr.detail.mail.reminded", {
                when: fmtWhen(h.mail.remindedAt, lang),
              })}
            </span>
          )}
          <span>
            {expired
              ? t("hr.detail.expiredOn", {
                when: fmtWhen(h.tokenExpiresAt, lang),
              })
              : t("hr.detail.expires", {
                when: fmtWhen(h.tokenExpiresAt, lang),
              })}
          </span>
        </div>
      </section>

      <div class="hr-grid2">
        <section class="panel">
          <h2 class="panel__title">{t("hr.detail.preview.sms")}</h2>
          <div class="hr-sms" data-cy="hr-sms-preview">
            {inviteText(h.firstName, company || "the team", h.signUrl)}
          </div>
        </section>
        <section class="panel">
          <h2 class="panel__title">{t("hr.detail.preview.email")}</h2>
          <div class="hr-email-prev">
            <strong>
              {t("hr.email.inviteSubject", {
                company: company || "the team",
              })}
            </strong>
            <p style="margin:6px 0 0">
              {t("hr.email.inviteBody", {
                first: h.firstName,
                company: company || "the team",
                url: h.signUrl,
              })}
            </p>
          </div>
        </section>
      </div>

      <section class="panel">
        <h2 class="panel__title">
          {t("hr.detail.packet")} <Progress {...h.progress} />
        </h2>
        <table class="table" data-cy="hr-packet">
          <thead>
            <tr>
              <th>{t("hr.detail.col.doc")}</th>
              <th>{t("hr.detail.col.kind")}</th>
              <th>{t("hr.detail.col.status")}</th>
              <th>{t("hr.detail.col.when")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {h.packet.map((d) => (
              <tr key={d.docId} data-cy="hr-packet-row">
                <td>
                  {d.name} <span class="hint">v{d.version}</span>
                </td>
                <td>{t(`hr.detail.kind.${d.kind}`)}</td>
                <td>
                  <span
                    class={`chip ${d.done ? "chip--green" : "chip--amber"}`}
                    data-cy="hr-doc-state"
                  >
                    {d.done ? t("hr.detail.done") : t("hr.detail.pending")}
                  </span>
                </td>
                <td>{fmtWhen(d.doneAt, lang)}</td>
                <td>
                  {d.done && (
                    <button
                      type="button"
                      class="btn btn--ghost btn--sm"
                      data-cy="hr-view-proof"
                      onClick={() => openProof(d.docId, d.name)}
                    >
                      <I d={ICN.eye} size={14} /> {t("hr.detail.view")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2 class="panel__title">
          {t("hr.detail.accounts")}
          {canProvision && !closed && (
            <button
              type="button"
              class="btn btn--teal btn--sm"
              style="margin-left:auto"
              data-cy="hr-provision"
              disabled={busy}
              onClick={() => act(() => hrClient.provision(id))}
            >
              <I d={ICN.bolt} size={14} /> {t("hr.detail.provisionNow")}
            </button>
          )}
        </h2>
        {h.systemIds.length === 0 && (
          <p class="hint">{t("hr.detail.accountsNone")}</p>
        )}
        {h.systemIds.length > 0 && h.provisioning.length === 0 && (
          <p class="hint" data-cy="hr-accounts-waiting">
            {t("hr.detail.accountsWaiting")}
          </p>
        )}
        <div class="hr-arms">
          {h.provisioning.map((a) => (
            <div
              key={a.systemId}
              class={`hr-arm hr-arm--${a.state}`}
              data-cy="hr-arm"
              data-state={a.state}
            >
              <div class="hr-arm__name">
                {a.name}
                <span class="chip chip--muted">{t(armKey(a.state))}</span>
              </div>
              {a.detail && <div class="hr-arm__detail">{a.detail}</div>}
              <div class="hr-arm__detail">{fmtWhen(a.at, lang)}</div>
              {!closed && a.state === "manual" && (
                <button
                  type="button"
                  class="btn btn--green btn--sm"
                  data-cy="hr-mark-done"
                  disabled={busy}
                  onClick={() => act(() => hrClient.markDone(id, a.systemId))}
                >
                  <I d={ICN.check} size={14} /> {t("hr.detail.markDone")}
                </button>
              )}
              {!closed && a.state === "fault" && (
                <button
                  type="button"
                  class="btn btn--pink btn--sm"
                  data-cy="hr-retry"
                  disabled={busy}
                  onClick={() => act(() => hrClient.provision(id, a.systemId))}
                >
                  <I d={ICN.refresh} size={14} /> {t("hr.detail.retry")}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {sendOpen && (
        <Backdrop
          class="modal-bg"
          onClose={() => !busy && setSendOpen(false)}
        >
          <div class="modal" data-cy="hr-send-modal">
            <h2>{t("hr.detail.sendTitle")}</h2>
            <p class="hint">
              {t("hr.detail.sendBody", {
                phone: h.phone || "—",
                email: h.email || "—",
              })}
            </p>
            <div class="hr-sms">
              {inviteText(h.firstName, company || "the team", h.signUrl)}
            </div>
            <div class="modal__foot">
              <button
                type="button"
                class="btn btn--ghost"
                onClick={() => setSendOpen(false)}
              >
                {t("hr.common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn--pink"
                data-cy="hr-send-now"
                disabled={busy}
                onClick={async () => {
                  await act(
                    () => hrClient.sendLink(id),
                    t("hr.detail.sentToast"),
                  );
                  setSendOpen(false);
                }}
              >
                <I d={ICN.send} size={14} /> {t("hr.detail.sendNow")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
      {offOpen && (
        <Backdrop
          class="modal-bg"
          onClose={() => !busy && setOffOpen(false)}
        >
          <div class="modal" data-cy="hr-offboard-modal">
            <h2>{t("hr.detail.offboard")}</h2>
            <p>{t("hr.detail.offboardConfirm")}</p>
            <div class="modal__foot">
              <button
                type="button"
                class="btn btn--ghost"
                onClick={() => setOffOpen(false)}
              >
                {t("hr.common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn--danger"
                data-cy="hr-offboard-confirm"
                disabled={busy}
                onClick={async () => {
                  await act(() => hrClient.offboard(id));
                  setOffOpen(false);
                }}
              >
                {t("hr.detail.offboard")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
      {proof && (
        <Backdrop class="modal-bg" onClose={() => setProof(null)}>
          <div class="modal" data-cy="hr-proof-modal">
            <h2>
              {proof.proof.kind === "sign"
                ? t("hr.proof.title")
                : t("hr.proof.ackTitle")}
            </h2>
            <p class="hint">
              {proof.name} ·{" "}
              {t("hr.proof.version", { n: proof.proof.docVersion })}
            </p>
            {proof.proof.signaturePng
              ? (
                <img
                  class="hr-sig-img"
                  src={proof.proof.signaturePng}
                  alt=""
                  data-cy="hr-proof-sig"
                />
              )
              : (
                <div class="hr-sig-font" data-cy="hr-proof-sig">
                  {proof.proof.printedName}
                </div>
              )}
            <dl class="hr-meta">
              <div>
                <dt>{t("hr.proof.printed")}</dt>
                <dd data-cy="hr-proof-name">{proof.proof.printedName}</dd>
              </div>
              <div>
                <dt>{t("hr.proof.signedAt")}</dt>
                <dd>{fmtWhen(proof.proof.at, lang)}</dd>
              </div>
            </dl>
            <p class="hint">{proof.proof.consentText}</p>
            <p class="hr-audit" data-cy="hr-proof-audit">
              {t("hr.proof.audit", {
                ua: proof.proof.userAgent.slice(0, 60),
                ip: proof.proof.ip,
              })}
            </p>
            <div class="modal__foot">
              <button
                type="button"
                class="btn btn--ghost"
                onClick={() => setProof(null)}
              >
                {t("hr.common.close")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
      <Toast msg={toast} />
    </>
  );
}
