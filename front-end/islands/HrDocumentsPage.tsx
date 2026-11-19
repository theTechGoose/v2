/**
 * REQ-886 — /hr/documents: the library (every document, its kind and version) and the builder
 * (`?doc=<id>`): a Google-Docs-style page with a formatting toolbar, or an imported PDF with its
 * pages drawn by pdf.js and signature/initials/date/name/text/check fields stamped where they go
 * (click to place, drag to move, double-click to remove). Save bumps the version when the content
 * changed; Delete discards it (departments drop it; signed packets keep their copy).
 * Data: /hr/documents (clients/hr.ts). Strings: hr.docs.*.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type DocField,
  type FieldType,
  hrClient,
  type HrDocument,
} from "../clients/hr.ts";
import Backdrop from "../components/Backdrop.tsx";
import FieldHead from "../components/FieldHead.tsx";
import { friendlyHr, Toast, useToast } from "../components/hr/bits.tsx";
import { I, ICN } from "../lib/dash-icons.tsx";
import { FIELD_TYPES, placeField } from "../lib/hr.ts";
import { t } from "../lib/i18n.ts";
import {
  fileToBase64,
  type RenderedPage,
  renderPdfPages,
} from "../lib/pdfjs.ts";

const MAX_PDF = 8 * 1024 * 1024;
const PAGE_W = 720;

export default function HrDocumentsPage(
  { initialDocId }: { initialDocId?: string },
) {
  const [docs, setDocs] = useState<HrDocument[] | null>(null);
  const [open, setOpen] = useState<HrDocument | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, say] = useToast();

  async function load() {
    const list = await hrClient.documents();
    setDocs(list);
    return list;
  }
  useEffect(() => {
    load().then((list) => {
      if (initialDocId) {
        const d = list.find((x) => x.id === initialDocId);
        if (d) setOpen(d);
      }
    }).catch(() => setErr(t("hr.common.error")));
  }, []);

  function go(d: HrDocument | null) {
    setOpen(d);
    const url = d
      ? `/hr/documents?doc=${encodeURIComponent(d.id)}`
      : "/hr/documents";
    history.replaceState(null, "", url);
  }

  async function create() {
    setErr(null);
    try {
      const d = await hrClient.createDocument({ name: "", kind: "ack" });
      await load();
      go(d);
    } catch (e) {
      setErr(friendlyHr(e, "hr.docs"));
    }
  }

  if (open) {
    return (
      <>
        <Builder
          key={open.id}
          doc={open}
          onBack={async () => {
            await load().catch(() => {});
            go(null);
          }}
          onSaved={(d) => {
            setOpen(d);
            say(t("hr.docs.saved", { n: d.version }));
            load().catch(() => {});
          }}
          onDiscarded={async () => {
            await load().catch(() => {});
            go(null);
          }}
        />
        <Toast msg={toast} />
      </>
    );
  }

  const live = (docs ?? []).filter((d) => !d.discardedAt);
  return (
    <>
      <FieldHead
        eyebrow={t("hr.docs.eyebrow")}
        title={t("hr.docs.title")}
        sub={t("hr.docs.sub")}
      >
        <button
          type="button"
          class="btn btn--pink"
          data-cy="hr-doc-new"
          onClick={create}
        >
          <I d={ICN.plus} size={14} /> {t("hr.docs.new")}
        </button>
      </FieldHead>
      {err && <p class="alert">{err}</p>}
      {docs && live.length === 0 && (
        <p class="hr-empty" data-cy="hr-docs-empty">{t("hr.docs.empty")}</p>
      )}
      <div class="hr-doc-grid" data-cy="hr-doc-grid">
        {live.map((d) => (
          <button
            type="button"
            class="hr-doc-card"
            key={d.id}
            data-cy="hr-doc-card"
            onClick={() => go(d)}
          >
            <span class="hr-doc-card__name" data-cy="hr-doc-card-name">
              {d.name || t("hr.docs.untitled")}
            </span>
            <span class="hr-doc-card__meta">
              <span
                class={`chip ${
                  d.kind === "sign" ? "chip--green" : "chip--teal"
                }`}
              >
                {t(`hr.docs.card.${d.kind}`)}
              </span>
              <span class="chip chip--muted">
                {t(`hr.docs.card.${d.type}`)}
              </span>
              <span>{t("hr.docs.card.v", { n: d.version })}</span>
              {d.type === "pdf" && (
                <span>
                  {t(
                    `hr.docs.card.fields.${
                      d.fields.length === 1 ? "one" : "other"
                    }`,
                    { n: d.fields.length },
                  )}
                </span>
              )}
            </span>
            {d.category && <span class="hint">{d.category}</span>}
          </button>
        ))}
        <button
          type="button"
          class="hr-doc-card hr-doc-card--new"
          onClick={create}
        >
          <I d={ICN.plus} size={14} /> {t("hr.docs.new")}
        </button>
      </div>
      <Toast msg={toast} />
    </>
  );
}

interface BuilderProps {
  doc: HrDocument;
  onBack: () => void;
  onSaved: (d: HrDocument) => void;
  onDiscarded: () => void;
}

function Builder({ doc, onBack, onSaved, onDiscarded }: BuilderProps) {
  const [name, setName] = useState(doc.name);
  const [label, setLabel] = useState(doc.label);
  const [category, setCategory] = useState(doc.category);
  const [kind, setKind] = useState(doc.kind);
  const [creds, setCreds] = useState(doc.creds);
  const [fields, setFields] = useState<DocField[]>(doc.fields);
  const [pdf, setPdf] = useState<
    { fileId: string | null; name: string | null }
  >({
    fileId: doc.pdfFileId,
    name: doc.pdfName,
  });
  const [pages, setPages] = useState<
    RenderedPage[] | null | "loading" | "unavailable"
  >(null);
  const [stamp, setStamp] = useState<FieldType | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isPdf = !!pdf.fileId;

  useEffect(() => {
    if (pageRef.current && !isPdf) pageRef.current.innerHTML = doc.contentHtml;
  }, [doc.id, isPdf]);

  useEffect(() => {
    if (!isPdf) return;
    setPages("loading");
    renderPdfPages({ url: hrClient.pdfUrl(doc.id) }, PAGE_W)
      .then((p) => setPages(p ?? "unavailable"))
      .catch(() => setPages("unavailable"));
  }, [doc.id, pdf.fileId]);

  const html = () => pageRef.current?.innerHTML ?? doc.contentHtml;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const d = await hrClient.saveDocument(doc.id, {
        name: name.trim(),
        label: label.trim(),
        category: category.trim(),
        kind: isPdf ? "sign" : kind,
        creds,
        fields,
        contentHtml: isPdf ? "" : html(),
      });
      onSaved(d);
    } catch (e) {
      setErr(friendlyHr(e, "hr.docs"));
    } finally {
      setBusy(false);
    }
  }

  async function importPdf(file: File) {
    setErr(null);
    if (file.size > MAX_PDF) return setErr(t("hr.docs.err.pdf_too_large"));
    if (!/pdf$/i.test(file.name) && file.type !== "application/pdf") {
      return setErr(t("hr.docs.err.not_pdf"));
    }
    setBusy(true);
    try {
      const d = await hrClient.importPdf(
        doc.id,
        file.name,
        await fileToBase64(file),
      );
      setPdf({ fileId: d.pdfFileId, name: d.pdfName });
      setKind("sign");
      if (!name.trim()) setName(d.name);
      setFields(d.fields);
      onSaved(d);
    } catch (e) {
      setErr(friendlyHr(e, "hr.docs"));
    } finally {
      setBusy(false);
    }
  }

  function exec(cmd: string, value?: string) {
    pageRef.current?.focus();
    document.execCommand(cmd, false, value);
  }

  function clickPage(e: MouseEvent, pageIndex: number) {
    if (!stamp) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const f = placeField(
      stamp,
      pageIndex,
      ((e.clientX - r.left) / r.width) * 100,
      ((e.clientY - r.top) / r.height) * 100,
    );
    setFields((fs) => [...fs, f]);
  }

  function dragChip(e: PointerEvent, f: DocField) {
    e.stopPropagation();
    const chip = e.currentTarget as HTMLElement;
    const page = chip.parentElement as HTMLElement;
    const r = page.getBoundingClientRect();
    chip.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(
        1,
        Math.min(99, ((ev.clientX - r.left) / r.width) * 100),
      );
      const y = Math.max(
        1,
        Math.min(99, ((ev.clientY - r.top) / r.height) * 100),
      );
      setFields((fs) =>
        fs.map((o) => (o.id === f.id ? { ...o, xPct: x, yPct: y } : o))
      );
    };
    const up = () => {
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", up);
    };
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerup", up);
  }

  return (
    <>
      <FieldHead
        eyebrow={t("hr.docs.eyebrow")}
        title={name || t("hr.docs.untitled")}
      >
        <span class="chip chip--muted" data-cy="hr-doc-version">
          {t("hr.docs.card.v", { n: doc.version })}
        </span>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="hr-doc-back"
          onClick={onBack}
        >
          <I d={ICN.back} size={14} /> {t("hr.docs.back")}
        </button>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="hr-doc-discard"
          disabled={busy}
          onClick={() => setConfirmDiscard(true)}
        >
          <I d={ICN.trash} size={14} /> {t("hr.docs.discard")}
        </button>
        <button
          type="button"
          class="btn btn--green"
          data-cy="hr-doc-save"
          disabled={busy}
          onClick={save}
        >
          <I d={ICN.check} size={14} /> {t("hr.docs.save")}
        </button>
      </FieldHead>
      {err && <p class="alert" data-cy="hr-doc-err">{err}</p>}
      <section class="panel">
        <div class="row">
          <label class="field">
            <span>{t("hr.docs.name")}</span>
            <input
              value={name}
              data-cy="hr-doc-name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span>{t("hr.docs.label")}</span>
            <input
              value={label}
              data-cy="hr-doc-label"
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span>{t("hr.docs.category")}</span>
            <input
              value={category}
              data-cy="hr-doc-category"
              onInput={(e) => setCategory((e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span>{t("hr.docs.kind")}</span>
            <select
              value={isPdf ? "sign" : kind}
              disabled={isPdf}
              data-cy="hr-doc-kind"
              onChange={(e) =>
                setKind(
                  (e.target as HTMLSelectElement).value as "ack" | "sign",
                )}
            >
              <option value="ack">{t("hr.docs.kind.ack")}</option>
              <option value="sign">{t("hr.docs.kind.sign")}</option>
            </select>
          </label>
          <label class="field" style="justify-content:flex-end">
            <span style="display:flex;align-items:center;gap:8px;margin-top:22px">
              <input
                type="checkbox"
                checked={creds}
                data-cy="hr-doc-creds"
                onChange={(e) =>
                  setCreds((e.target as HTMLInputElement).checked)}
              />
              {t("hr.docs.creds")}
            </span>
          </label>
        </div>
      </section>
      <section class="panel">
        <div class="docs-toolbar" data-cy="hr-doc-toolbar">
          {!isPdf && (
            <>
              <button
                type="button"
                title={t("hr.docs.tool.bold")}
                onClick={() => exec("bold")}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                title={t("hr.docs.tool.italic")}
                onClick={() => exec("italic")}
              >
                <i>I</i>
              </button>
              <button
                type="button"
                title={t("hr.docs.tool.underline")}
                onClick={() => exec("underline")}
              >
                <u>U</u>
              </button>
              <span class="docs-toolbar__sep" />
              <button type="button" onClick={() => exec("formatBlock", "<h1>")}>
                {t("hr.docs.tool.h1")}
              </button>
              <button type="button" onClick={() => exec("formatBlock", "<h2>")}>
                {t("hr.docs.tool.h2")}
              </button>
              <button type="button" onClick={() => exec("formatBlock", "<p>")}>
                {t("hr.docs.tool.p")}
              </button>
              <span class="docs-toolbar__sep" />
              <button type="button" onClick={() => exec("insertUnorderedList")}>
                {t("hr.docs.tool.ul")}
              </button>
              <button type="button" onClick={() => exec("insertOrderedList")}>
                {t("hr.docs.tool.ol")}
              </button>
            </>
          )}
          {isPdf && (
            <div class="hr-stamps" data-cy="hr-stamps">
              <span class="hint">{t("hr.docs.fields")}</span>
              {(Object.keys(FIELD_TYPES) as FieldType[]).map((ft) => (
                <button
                  type="button"
                  key={ft}
                  class={`hr-stamp ${stamp === ft ? "hr-stamp--on" : ""}`}
                  data-cy={`hr-stamp-${ft}`}
                  onClick={() => setStamp(stamp === ft ? null : ft)}
                >
                  <span
                    class="hr-stamp__dot"
                    style={`background:${FIELD_TYPES[ft].color}`}
                  />
                  {t(FIELD_TYPES[ft].key)}
                </button>
              ))}
            </div>
          )}
          <span class="docs-toolbar__spacer" />
          {isPdf && pdf.name && (
            <span class="hint">{t("hr.docs.pdfName", { name: pdf.name })}</span>
          )}
          <button
            type="button"
            data-cy="hr-doc-open-pdf"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <I d={ICN.doc} size={14} /> {t("hr.docs.openPdf")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            style="display:none"
            data-cy="hr-doc-pdf-input"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) importPdf(f);
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </div>
        {isPdf && (
          <p class="hint" style="margin:0 0 10px">{t("hr.docs.stampHint")}</p>
        )}
        <div class="docs-stage">
          {!isPdf && (
            <div
              ref={pageRef}
              class="docs-page"
              contentEditable
              data-cy="hr-doc-page"
              data-placeholder={t("hr.docs.placeholder")}
            />
          )}
          {isPdf && pages === "loading" && (
            <p class="hint">{t("hr.docs.rendering")}</p>
          )}
          {isPdf && pages === "unavailable" && (
            <p class="hint" data-cy="hr-doc-norenderer">
              {t("hr.docs.noRenderer")}{" "}
              <a href={hrClient.pdfUrl(doc.id)} target="_blank" rel="noopener">
                {pdf.name}
              </a>
            </p>
          )}
          {isPdf && Array.isArray(pages) && pages.map((p) => (
            <div
              key={p.index}
              class={`docs-pdf-page ${stamp ? "docs-pdf-page--stamping" : ""}`}
              style={`width:${p.width}px;height:${p.height}px`}
              data-cy="hr-pdf-page"
              ref={(el) => {
                if (el && !el.contains(p.canvas)) el.prepend(p.canvas);
              }}
              onClick={(e) => clickPage(e, p.index)}
            >
              <span class="docs-pdf-page__n">
                {t("hr.docs.pageN", { n: p.index + 1 })}
              </span>
              {fields.filter((f) => f.page === p.index).map((f) => (
                <span
                  key={f.id}
                  class="pdf-field"
                  data-cy="hr-pdf-field"
                  data-type={f.type}
                  style={`left:${f.xPct}%;top:${f.yPct}%;background:${
                    FIELD_TYPES[f.type].color
                  }`}
                  onClick={(e) => e.stopPropagation()}
                  onDblClick={(e) => {
                    e.stopPropagation();
                    setFields((fs) => fs.filter((o) => o.id !== f.id));
                  }}
                  onPointerDown={(e) => dragChip(e, f)}
                >
                  {t(FIELD_TYPES[f.type].key)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>
      {confirmDiscard && (
        <Backdrop
          class="modal-bg"
          onClose={() => setConfirmDiscard(false)}
        >
          <div class="modal" data-cy="hr-doc-discard-modal">
            <h2>{t("hr.docs.discard")}</h2>
            <p>{t("hr.docs.discardConfirm")}</p>
            <div class="modal__foot">
              <button
                type="button"
                class="btn btn--ghost"
                onClick={() => setConfirmDiscard(false)}
              >
                {t("hr.common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn--danger"
                data-cy="hr-doc-discard-confirm"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await hrClient.discardDocument(doc.id);
                    onDiscarded();
                  } catch (e) {
                    setErr(friendlyHr(e, "hr.docs"));
                    setBusy(false);
                  }
                }}
              >
                {t("hr.docs.discard")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
    </>
  );
}
