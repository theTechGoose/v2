/**
 * REQ-885 — /sign/:token, the hire's phone page. No dashboard chrome. Opens the packet by the
 * token (the hire is "opened" from here on), greets by first name, then one document per step:
 * the text (or the PDF's pages with the stamped fields), the credentials box when the document
 * asks for it, and either the acknowledgment checkbox or the printed name + the drawn signature.
 * Continue posts the proof; the last one is "Sign & finish" and lands on MONSTERIZED. An
 * expired link says so (410); an unknown one too (404). Strings: hr.sign.*.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { hrSignClient, type SignDoc, type SignPacket } from "../clients/hr.ts";
import SignaturePad from "../components/hr/SignaturePad.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { friendlyHr } from "../components/hr/bits.tsx";
import { ApiError } from "../lib/api.ts";
import { FIELD_TYPES } from "../lib/hr.ts";
import { type Lang, langSignal, setLang, t } from "../lib/i18n.ts";
import { type RenderedPage, renderPdfPages } from "../lib/pdfjs.ts";

interface Props {
  token: string;
  initialLang: Lang;
}

type Screen = "loading" | "gone" | "expired" | "intro" | "doc" | "done";

export default function HrSignPacket({ token, initialLang }: Props) {
  // seed the language from the route before the first paint (REQ-709 idiom)
  if (langSignal.value !== initialLang) langSignal.value = initialLang;
  const lang = langSignal.value;
  const [p, setP] = useState<SignPacket | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [i, setI] = useState(0);
  const [consent, setConsent] = useState(false);
  const [printed, setPrinted] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLang(initialLang, { fromServer: true });
    hrSignClient.open(token).then((pk) => {
      setP(pk);
      const first = pk.docs.findIndex((d) => !d.done);
      if (pk.progress.total > 0 && first === -1) setScreen("done");
      else {
        setI(Math.max(0, first));
        setScreen("intro");
      }
    }).catch((e) => {
      setScreen(e instanceof ApiError && e.status === 410 ? "expired" : "gone");
    });
  }, [token]);

  const docs = p?.docs ?? [];
  const doc: SignDoc | undefined = docs[i];
  const total = docs.length;
  const stepN = Math.min(i + 1, total);
  const isLast = i >= total - 1;

  function reset() {
    setConsent(false);
    setPrinted("");
    setSig(null);
    setErr(null);
  }

  async function submit() {
    if (!doc || !p) return;
    setErr(null);
    if (!consent) return setErr(t("hr.sign.err.consent_required"));
    if (doc.kind === "sign" && (!sig || !printed.trim())) {
      return setErr(t("hr.sign.err.signature_required"));
    }
    setBusy(true);
    try {
      const r = await hrSignClient.sign(token, doc.docId, {
        consent: true,
        printedName: printed.trim() || undefined,
        signaturePng: doc.kind === "sign" ? sig ?? undefined : undefined,
      });
      const next = docs.map((d, k) =>
        k === i ? { ...d, done: true, doneAt: r.proof.at } : d
      );
      setP({ ...p, docs: next, progress: r.progress, status: r.status });
      if (r.complete || isLast) setScreen("done");
      else {
        const n = next.findIndex((d, k) => k > i && !d.done);
        setI(n === -1 ? i + 1 : n);
        reset();
        globalThis.scrollTo?.(0, 0);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // already signed on another screen: move on
        if (isLast) setScreen("done");
        else {
          setI(i + 1);
          reset();
        }
      } else setErr(friendlyHr(e, "hr.sign"));
    } finally {
      setBusy(false);
    }
  }

  const company = p?.companyName || "";
  const pct = screen === "done"
    ? 100
    : total
    ? Math.round(((screen === "intro" ? 0 : i) / total) * 100)
    : 0;

  return (
    <div class="hrs">
      <div class="hrs__card" data-cy="hrs-card" data-screen={screen}>
        <div class="hrs__top">
          <span class="hrs__brand">{company || "DocuMonster"}</span>
          {screen === "doc" && (
            <span class="hrs__step" data-cy="hrs-step">
              {t("hr.sign.step", { n: stepN, total })}
            </span>
          )}
          <button
            type="button"
            class="hrs__lang"
            data-cy="hrs-lang"
            onClick={() => setLang(lang === "en" ? "es" : "en")}
          >
            {t("hr.sign.lang")}
          </button>
        </div>
        <div class="hrs__bar">
          <i style={`width:${pct}%`} />
        </div>

        {screen === "loading" && (
          <div class="hrs__body">
            <p class="hrs__p">{t("hr.common.loading")}</p>
          </div>
        )}
        {screen === "gone" && (
          <div class="hrs__body">
            <p class="hrs__p" data-cy="hrs-gone">{t("hr.sign.notFound")}</p>
          </div>
        )}
        {screen === "expired" && (
          <div class="hrs__body">
            <p class="hrs__p" data-cy="hrs-expired">{t("hr.sign.expired")}</p>
          </div>
        )}

        {screen === "intro" && p && (
          <>
            <div class="hrs__body">
              <div class="hrs__eyebrow">
                {t("hr.sign.welcome", { company: company || "the team" })}
              </div>
              <h1 class="hrs__title" data-cy="hrs-hi">
                {t("hr.sign.hi", { first: p.firstName })}
              </h1>
              {total === 0
                ? (
                  // REQ-932 — a packet with nothing in it: say so, no promise and no dead button
                  <p class="hrs__p" data-cy="hrs-empty">
                    {t("hr.sign.empty", { company: company || "the team" })}
                  </p>
                )
                : (
                  <>
                    <p class="hrs__p">{t("hr.sign.intro")}</p>
                    <p class="hrs__p">
                      <strong>
                        {t("hr.sign.dept", { department: p.departmentName })}
                      </strong>{" "}
                      · {t("hr.sign.docsCount", { n: total })}
                    </p>
                  </>
                )}
              <ul class="hrs__list" data-cy="hrs-intro-list">
                {docs.map((d) => (
                  <li key={d.docId}>
                    {d.name}
                    <span
                      class={`chip ${d.done ? "chip--green" : "chip--muted"}`}
                    >
                      {d.done
                        ? t("hr.sign.signed")
                        : t(`hr.sign.kind.${d.kind}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {total > 0 && (
              <div class="hrs__foot">
                <button
                  type="button"
                  class="btn btn--pink"
                  data-cy="hrs-start"
                  onClick={() => setScreen("doc")}
                >
                  {t("hr.sign.start")}
                </button>
              </div>
            )}
          </>
        )}

        {screen === "doc" && doc && (
          <>
            <div class="hrs__body">
              <div class="hrs__eyebrow">
                {t(`hr.sign.kind.${doc.kind}`)}
                {doc.category ? ` · ${doc.category}` : ""}
              </div>
              <h1 class="hrs__title" data-cy="hrs-doc-title">{doc.name}</h1>
              <div class="hrs__doc" data-cy="hrs-doc-body">
                {doc.type === "pdf"
                  ? <PdfPages token={token} doc={doc} />
                  : (
                    <div
                      dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
                    />
                  )}
                {doc.creds && doc.credentials && (
                  <dl class="hrs__creds" data-cy="hrs-creds">
                    <dt>{t("hr.sign.creds.user")}</dt>
                    <dd>{doc.credentials.username || "—"}</dd>
                    <dt>{t("hr.sign.creds.pass")}</dt>
                    <dd>{doc.credentials.password || "—"}</dd>
                  </dl>
                )}
              </div>
              <label class="hrs__ack">
                <input
                  type="checkbox"
                  checked={consent}
                  data-cy="hrs-ack"
                  onChange={(e) =>
                    setConsent((e.target as HTMLInputElement).checked)}
                />
                <span>
                  {t("hr.sign.ack", { label: doc.label || doc.name })}
                </span>
              </label>
              {doc.kind === "sign" && (
                <>
                  <div class="hrs__field">
                    <label>{t("hr.sign.printed")}</label>
                    <input
                      value={printed}
                      data-cy="hrs-printed"
                      autocomplete="name"
                      onInput={(e) =>
                        setPrinted((e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div class="hrs__field">
                    <label>{t("hr.sign.draw")}</label>
                    <SignaturePad
                      resetKey={doc.docId}
                      onChange={setSig}
                      clearLabel={t("hr.sign.clear")}
                      hint={t("hr.sign.drawHint")}
                    />
                  </div>
                </>
              )}
              {err && <p class="hrs__err" data-cy="hrs-err">{err}</p>}
            </div>
            <div class="hrs__foot">
              <button
                type="button"
                class="btn btn--green"
                data-cy="hrs-next"
                disabled={busy}
                onClick={submit}
              >
                {isLast ? t("hr.sign.finish") : t("hr.sign.continue")}
              </button>
            </div>
          </>
        )}

        {screen === "done" && (
          <div class="hrs__body">
            <div class="hrs__done" data-cy="hrs-done">
              <span class="hrs__done-mark">
                <Icon name="check" size={40} />
              </span>
              <div class="hrs__eyebrow">{t("hr.sign.done.eyebrow")}</div>
              <h1 class="hrs__title">{t("hr.sign.done.title")}</h1>
              <p class="hrs__p">
                {t("hr.sign.done.body", { company: company || "the team" })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPages({ token, doc }: { token: string; doc: SignDoc }) {
  const [pages, setPages] = useState<
    RenderedPage[] | null | "loading" | "unavailable"
  >("loading");
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const w = Math.min(420, (hostRef.current?.clientWidth || 360) - 2);
    renderPdfPages({ url: hrSignClient.pdfUrl(token, doc.docId) }, w)
      .then((p) => setPages(p ?? "unavailable"))
      .catch(() => setPages("unavailable"));
  }, [doc.docId]);
  return (
    <div ref={hostRef} data-cy="hrs-pdf">
      {pages === "loading" && <p class="hrs__p">{t("hr.sign.pdfLoading")}</p>}
      {pages === "unavailable" && (
        <p class="hrs__p">
          <a
            href={hrSignClient.pdfUrl(token, doc.docId)}
            target="_blank"
            rel="noopener"
          >
            {t("hr.sign.pdfFallback")}
          </a>
        </p>
      )}
      {Array.isArray(pages) && pages.map((p) => (
        <div
          key={p.index}
          class="docs-pdf-page"
          style={`width:${p.width}px;height:${p.height}px`}
          ref={(el) => {
            if (el && !el.contains(p.canvas)) el.prepend(p.canvas);
          }}
        >
          {doc.fields.filter((f) => f.page === p.index).map((f) => (
            <span
              key={f.id}
              class="pdf-field pdf-field--static"
              style={`left:${f.xPct}%;top:${f.yPct}%;background:${
                FIELD_TYPES[f.type].color
              }`}
            >
              {t(FIELD_TYPES[f.type].key)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
