/**
 * REQ-920a/c — the Phone page's Texting registration panel (A2P 10DLC) for a
 * customer's line. It takes the business's details once — Business /
 * Representative / Address / Messaging — and the backend walks Twilio's ISV
 * flow on the line's subaccount. Above the form: where it stands (profile →
 * brand → campaign, each with Twilio's errors when it fails), "Check status"
 * (and a refresh whenever the panel opens), the ISV-prerequisite line when the
 * platform's own profile is not ISV-type yet, and — before submit — who pays
 * the registration fees. Data: commsClient.a2p / a2pSubmit / a2pRefresh;
 * pure rules: lib/a2p.ts; strings: comms.a2p.*.
 */
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  type A2pRegistration,
  commsClient,
  type PublicLine,
} from "../../clients/communications.ts";
import {
  a2pFieldErrors,
  type A2pFormState,
  a2pHeadline,
  BUSINESS_TYPES,
  COMPANY_TYPES,
  defaultCopy,
  emptyA2pForm,
  formFromRegistration,
  HEADLINE_CHIP,
  INDUSTRIES,
  JOB_POSITIONS,
  STEP_CHIP,
  stepStatuses,
  STOCK_EXCHANGES,
  toA2pBody,
  USE_CASES,
  validateA2pForm,
} from "../../lib/a2p.ts";
import { t } from "../../lib/i18n.ts";

type Key = keyof A2pFormState;
type StrKey = {
  [K in Key]: A2pFormState[K] extends string ? K : never;
}[Key];

const STEPS = ["profile", "brand", "campaign"] as const;
/** the strip step a Twilio error belongs to */
const STEP_OF: Record<string, (typeof STEPS)[number]> = {
  primary: "profile",
  profile: "profile",
  trust_product: "profile",
  brand: "brand",
  service: "campaign",
  campaign: "campaign",
};
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_");

export default function A2pPanel({ line }: { line: PublicLine }) {
  const [reg, setReg] = useState<A2pRegistration | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<A2pFormState>(emptyA2pForm());
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "submit" | "check">("");
  const [err, setErr] = useState<string | null>(null);

  // REQ-920a — read it, then ask Twilio again, every time the panel opens
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const first = (await commsClient.a2p()).registration;
        if (!live) return;
        setReg(first);
        if (first) {
          setForm(formFromRegistration(first));
          const fresh = await commsClient.a2pRefresh();
          if (live && fresh) setReg(fresh);
        }
      } catch {
        if (live) setErr(t("comms.a2p.err.generic"));
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [line.id]);

  /** a change; the suggested opt-in / opt-out / help wording follows the name and phone until the person edits it */
  function set<K extends Key>(k: K, v: A2pFormState[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v } as A2pFormState;
      if (k === "legalName" || k === "repPhone") {
        const before = defaultCopy(f.legalName, f.repPhone);
        const after = defaultCopy(next.legalName, next.repPhone);
        for (const c of Object.keys(after) as (keyof typeof after)[]) {
          if (!f[c] || f[c] === before[c]) next[c] = after[c];
        }
      }
      return next;
    });
    if (errs[k]) setErrs((e) => ({ ...e, [k]: "" }));
  }

  async function submit(e: Event) {
    e.preventDefault();
    const local = validateA2pForm(form);
    if (Object.keys(local).length) {
      setErrs(
        Object.fromEntries(Object.entries(local).map(([k, v]) => [k, t(v)])),
      );
      setErr(t("comms.a2p.err.form"));
      return;
    }
    setBusy("submit");
    setErr(null);
    setErrs({});
    try {
      setReg(await commsClient.a2pSubmit(toA2pBody(form)));
    } catch (e) {
      const fields = a2pFieldErrors(e);
      if (Object.keys(fields).length) {
        setErrs(fields);
        setErr(t("comms.a2p.err.form"));
      } else setErr(t("comms.a2p.err.generic"));
    } finally {
      setBusy("");
    }
  }

  async function check() {
    setBusy("check");
    setErr(null);
    try {
      const r = await commsClient.a2pRefresh();
      if (r) setReg(r);
    } catch {
      setErr(t("comms.a2p.err.generic"));
    } finally {
      setBusy("");
    }
  }

  const head = a2pHeadline(reg);
  const steps = stepStatuses(reg);
  const showForm = loaded && !reg?.profileSubmitted;

  // ── inputs ──
  const field = (
    k: string,
    label: string,
    control: ComponentChildren,
    hint?: string,
  ) => (
    <label class="field a2p-field" data-cy={`a2p-field-${k}`}>
      {label}
      {control}
      {hint && <span class="hint">{hint}</span>}
      {errs[k] && (
        <span class="field-error" data-cy="a2p-field-err" data-field={k}>
          {errs[k]}
        </span>
      )}
    </label>
  );
  const text = (k: StrKey, type = "text", hint?: string) =>
    field(
      k,
      t(`comms.a2p.f.${k}`),
      <input
        type={type}
        value={form[k]}
        data-cy={`a2p-${k}`}
        aria-invalid={errs[k] ? "true" : undefined}
        onInput={(e) => set(k, (e.target as HTMLInputElement).value)}
      />,
      hint,
    );
  const area = (k: StrKey, hint?: string) =>
    field(
      k,
      t(`comms.a2p.f.${k}`),
      <textarea
        rows={3}
        value={form[k]}
        data-cy={`a2p-${k}`}
        aria-invalid={errs[k] ? "true" : undefined}
        onInput={(e) => set(k, (e.target as HTMLTextAreaElement).value)}
      />,
      hint,
    );
  const select = (
    k: StrKey,
    options: readonly string[],
    labelOf: (v: string) => string,
  ) =>
    field(
      k,
      t(`comms.a2p.f.${k}`),
      <select
        value={form[k]}
        data-cy={`a2p-${k}`}
        aria-invalid={errs[k] ? "true" : undefined}
        onChange={(e) => set(k, (e.target as HTMLSelectElement).value)}
      >
        <option value="">{t("comms.a2p.choose")}</option>
        {options.map((o) => <option key={o} value={o}>{labelOf(o)}</option>)}
      </select>,
    );
  const check2 = (k: "hasEmbeddedLinks" | "hasEmbeddedPhone") => (
    <label class="a2p-check" data-cy={`a2p-field-${k}`}>
      <input
        type="checkbox"
        checked={form[k]}
        data-cy={`a2p-${k}`}
        onChange={(e) =>
          set(k, (e.target as HTMLInputElement).checked)}
      />{" "}
      {t(`comms.a2p.f.${k}`)}
    </label>
  );

  return (
    <section
      class="panel a2p"
      data-cy="a2p-panel"
      data-state={reg?.state ?? "none"}
      data-loaded={loaded ? "1" : "0"}
    >
      <div class="a2p__head">
        <h2 class="panel__title">{t("comms.a2p.title")}</h2>
        <span
          class={`chip ${HEADLINE_CHIP[head]}`}
          data-cy="a2p-state"
          data-headline={head}
        >
          {t(`comms.a2p.state.${head}`)}
        </span>
      </div>
      <p class="hint">{t("comms.a2p.sub")}</p>

      {reg && (
        <ol class="a2p-strip" data-cy="a2p-strip">
          {STEPS.map((s) => (
            <li
              key={s}
              class="a2p-strip__step"
              data-cy="a2p-step"
              data-step={s}
              data-status={steps[s]}
            >
              <span class="a2p-strip__label">{t(`comms.a2p.step.${s}`)}</span>
              <span class={`chip ${STEP_CHIP[steps[s]]}`}>
                {t(`comms.a2p.status.${steps[s]}`)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {head === "needs_isv" && (
        <p class="alert" data-cy="a2p-isv">{t("comms.a2p.isv")}</p>
      )}
      {head === "pending" && (
        <p class="hint" data-cy="a2p-review">{t("comms.a2p.reviewNote")}</p>
      )}
      {head === "registered" && (
        <p class="hint" data-cy="a2p-registered">
          {t("comms.a2p.registeredNote")}
        </p>
      )}
      {reg && reg.errors.length > 0 && (
        <div class="a2p-errors" data-cy="a2p-errors">
          <strong>{t("comms.a2p.errorsTitle")}</strong>
          <ul>
            {reg.errors.map((e, i) => (
              <li key={i} data-cy="a2p-error" data-step={e.step}>
                {t(`comms.a2p.step.${STEP_OF[e.step] ?? "profile"}`)}:{" "}
                {e.message}
                {e.code !== undefined ? ` (${e.code})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && <p class="alert" data-cy="a2p-err">{err}</p>}
      {reg && (
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="a2p-check"
          disabled={busy !== ""}
          onClick={check}
        >
          {busy === "check" ? t("comms.a2p.checking") : t("comms.a2p.check")}
        </button>
      )}

      {showForm && (
        <form class="a2p-form" data-cy="a2p-form" onSubmit={submit} noValidate>
          <fieldset class="a2p-group" data-cy="a2p-group-business">
            <legend>{t("comms.a2p.group.business")}</legend>
            {text("legalName")}
            {text("ein", "text", t("comms.a2p.hint.ein"))}
            {select(
              "businessType",
              BUSINESS_TYPES,
              (v) =>
                t(`comms.a2p.businessType.${slug(v)}`),
            )}
            {select("industry", INDUSTRIES, (v) =>
              t(`comms.a2p.industry.${v}`))}
            {text("website", "url")}
            {text("socialUrls", "url")}
            {select(
              "companyType",
              COMPANY_TYPES,
              (v) =>
                t(`comms.a2p.companyType.${slug(v)}`),
            )}
            {form.companyType === "public" && (
              <>
                {select("stockExchange", STOCK_EXCHANGES, (v) => v)}
                {text("stockTicker")}
              </>
            )}
          </fieldset>

          <fieldset class="a2p-group" data-cy="a2p-group-rep">
            <legend>{t("comms.a2p.group.rep")}</legend>
            {text("repFirstName")}
            {text("repLastName")}
            {text("repEmail", "email")}
            {text("repPhone", "tel")}
            {text("repTitle")}
            {select(
              "repPosition",
              JOB_POSITIONS,
              (v) =>
                t(`comms.a2p.position.${slug(v)}`),
            )}
          </fieldset>

          <fieldset class="a2p-group" data-cy="a2p-group-address">
            <legend>{t("comms.a2p.group.address")}</legend>
            {text("street")}
            {text("city")}
            {text("region")}
            {text("postalCode")}
          </fieldset>

          <fieldset class="a2p-group" data-cy="a2p-group-messaging">
            <legend>{t("comms.a2p.group.messaging")}</legend>
            {select("useCase", USE_CASES, (v) => t(`comms.a2p.useCase.${v}`))}
            {area("description", t("comms.a2p.hint.description"))}
            {area("messageFlow", t("comms.a2p.hint.messageFlow"))}
            <div class="field a2p-field" data-cy="a2p-field-samples">
              {t("comms.a2p.f.samples")}
              {form.samples.map((s, i) => (
                <textarea
                  key={i}
                  rows={2}
                  value={s}
                  placeholder={t("comms.a2p.f.sample", { n: i + 1 })}
                  aria-label={t("comms.a2p.f.sample", { n: i + 1 })}
                  data-cy={`a2p-sample-${i}`}
                  aria-invalid={errs.samples && i < 2 ? "true" : undefined}
                  onInput={(e) => {
                    const next = [...form.samples];
                    next[i] = (e.target as HTMLTextAreaElement).value;
                    set("samples", next);
                  }}
                />
              ))}
              {errs.samples && (
                <span
                  class="field-error"
                  data-cy="a2p-field-err"
                  data-field="samples"
                >
                  {errs.samples}
                </span>
              )}
            </div>
            {area("optInMessage")}
            {area("optOutMessage")}
            {area("helpMessage")}
            {check2("hasEmbeddedLinks")}
            {check2("hasEmbeddedPhone")}
          </fieldset>

          <p class="hint a2p-fees" data-cy="a2p-fees">{t("comms.a2p.fees")}</p>
          <button
            type="submit"
            class="btn btn--teal"
            data-cy="a2p-submit"
            disabled={busy !== ""}
          >
            {busy === "submit"
              ? t("comms.a2p.submitting")
              : reg
              ? t("comms.a2p.resubmit")
              : t("comms.a2p.submit")}
          </button>
        </form>
      )}
      {loaded && reg?.profileSubmitted && (
        <p class="hint" data-cy="a2p-sent">{t("comms.a2p.sentNote")}</p>
      )}
    </section>
  );
}
