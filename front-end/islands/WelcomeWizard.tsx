/**
 * WelcomeWizard — the first-sign-in onboarding wizard mounted at /welcome.
 *
 * One question per screen with a real typed input, saving each answer
 * immediately through the existing profile endpoints. There is NO separate
 * wizard-state persistence: the saved profile data IS the state, so a reload
 * resumes at the first still-incomplete step.
 *
 * Navigation is never gated on completeness — every step is skippable-or-not
 * per its registry entry, and a low-key "Skip setup for now" escape marks
 * onboarding done and drops the user on the dashboard permanently.
 *
 * The step engine here is deliberately extensible: each phase of the build
 * adds entries to STEPS without touching the engine.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type Lang, langSignal, persistLang } from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";
import {
  type BusinessAddress,
  type BusinessIdentity,
  profileClient,
  type ProfileSnapshot,
} from "../clients/profile.ts";
import { filesClient } from "../clients/files.ts";
import { stateName, US_STATE_OPTIONS } from "../lib/us-states.ts";
import { api } from "../lib/api.ts";
import { type AddressSuggestion, suggestAddresses } from "../lib/mapbox.ts";

/** The concrete example prompts shown on the meet-your-assistant cards. Each
 *  mirrors something `handle-chat-message` actually supports (quote / invoice
 *  / follow-up). */
const EXAMPLE_PROMPTS = [
  {
    id: "quote",
    labelKey: "welcome.examples.quote.label",
    textKey: "welcome.examples.quote.text",
  },
  {
    id: "invoice",
    labelKey: "welcome.examples.invoice.label",
    textKey: "welcome.examples.invoice.text",
  },
  {
    id: "followup",
    labelKey: "welcome.examples.followup.label",
    textKey: "welcome.examples.followup.text",
  },
] as const;

/** Mark onboarding finished (not skipped) before leaving the wizard. */
async function markOnboardedFinish(): Promise<void> {
  await fetch("/api/me/onboarded", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ skipped: false }),
  }).catch(() => {});
}

interface Props {
  snapshot: ProfileSnapshot;
  /** Phone-area-code state guess from the backend (only present when no
   *  address state is set yet). Drives the state step's tap-to-confirm. */
  suggestedState?: string;
  initialLang?: Lang;
}

/** Seeded placeholder names set at signup — treated as "no name yet" so the
 *  name step prefills empty instead of the literal placeholder. Mirrors
 *  backend `isPlaceholderName` in verify-otp/mod.ts. */
const PLACEHOLDER_NAMES = ["New user", "Nuevo usuario"];
export function isPlaceholderName(name?: string): boolean {
  const n = (name ?? "").trim();
  return n.length === 0 || PLACEHOLDER_NAMES.includes(n);
}

// ---------------------------------------------------------------------------
// Step engine types
// ---------------------------------------------------------------------------

interface StepCtx {
  snap: ProfileSnapshot;
  suggestedState?: string;
  /** Merge freshly-saved values into the in-memory snapshot so later steps
   *  (and merge-saves) see them without a round-trip. */
  patchSnap: (partial: Partial<ProfileSnapshot>) => void;
  /** Advance to the next step (after a successful save, or a skip). */
  advance: () => void;
  goBack: () => void;
  canGoBack: boolean;
  skippable: boolean;
  index: number;
  total: number;
  /** Sample-quote id pre-generated at wizard mount (empty while the request
   *  is still in flight) so the preview step renders instantly. */
  sampleQuoteId: string;
  sampleQuoteFailed: boolean;
  retrySampleQuote: () => void;
}

/** A step is a real Preact component (rendered as `<Step ctx={ctx} />` with a
 *  key) so each owns its own hook context and remounts cleanly on advance —
 *  calling them as bare functions would append their hooks to the engine's
 *  hook list and crash on any step whose hook order differs. */
type StepComponent = (props: { ctx: StepCtx }) => ComponentChildren;

interface StepDef {
  id: string;
  skippable: boolean;
  /** Used once on mount to resume at the first incomplete step. */
  isComplete: (snap: ProfileSnapshot) => boolean;
  Component: StepComponent;
}

// ---------------------------------------------------------------------------
// Shared step chrome
// ---------------------------------------------------------------------------

function StepBody(
  { question, why, children }: {
    question: string;
    why?: string;
    children: ComponentChildren;
  },
) {
  // On each step mount (every advance remounts the keyed step component) move
  // focus to the step's first input so the user can just start typing. Every
  // input carries an aria-label equal to the question, so screen readers still
  // announce it. Steps with no input (the education screens) fall back to
  // focusing the heading so the new screen is still announced.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const focusable = fieldRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );
    if (focusable) focusable.focus();
    else headingRef.current?.focus();
  }, []);
  return (
    <div class="welcome__step">
      <h1 class="welcome__question" tabIndex={-1} ref={headingRef}>
        {question}
      </h1>
      {why ? <p class="welcome__why">{why}</p> : null}
      <div class="welcome__field" ref={fieldRef}>{children}</div>
    </div>
  );
}

function StepFooter(
  { ctx, valid, busy, onContinue, hideContinue }: {
    ctx: StepCtx;
    valid: boolean;
    busy: boolean;
    onContinue: () => void;
    /** UX-11: a step whose card already offers its own solid primary (the
     *  state tap-to-confirm banner) drops the footer Continue — one primary
     *  action per card, per the app's action-row rule. */
    hideContinue?: boolean;
  },
) {
  return (
    <div class="welcome__footer">
      {ctx.canGoBack
        ? (
          <button
            type="button"
            class="welcome__btn welcome__btn--ghost"
            onClick={ctx.goBack}
            disabled={busy}
          >
            {t("welcome.back")}
          </button>
        )
        : <span />}
      <div class="welcome__footer-right">
        {ctx.skippable
          ? (
            <button
              type="button"
              class="welcome__btn welcome__btn--ghost"
              onClick={ctx.advance}
              disabled={busy}
            >
              {t("welcome.skip")}
            </button>
          )
          : null}
        {!hideContinue && (
          <button
            type="button"
            class="welcome__btn welcome__btn--primary"
            onClick={() => onContinue()}
            disabled={!valid || busy}
          >
            {t("welcome.continue")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Concrete steps
// ---------------------------------------------------------------------------

function NameStep({ ctx }: { ctx: StepCtx }) {
  const initial = isPlaceholderName(ctx.snap.user.name)
    ? ""
    : (ctx.snap.user.name ?? "");
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = value.trim().length > 0;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await profileClient.updateUser({ name: value.trim() });
      ctx.patchSnap({ user: { ...ctx.snap.user, name: updated.name } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody question={t("welcome.name.question")} why={t("welcome.name.why")}>
      <input
        class="welcome__input"
        type="text"
        autoComplete="name"
        enterKeyHint="go"
        aria-label={t("welcome.name.question")}
        placeholder={t("welcome.name.placeholder")}
        value={value}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) =>
          setValue(e.currentTarget.value)}
        // deno-lint-ignore no-explicit-any
        onKeyDown={(e: any) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

function BusinessNameStep({ ctx }: { ctx: StepCtx }) {
  const [value, setValue] = useState(ctx.snap.identity?.businessName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = value.trim().length > 0;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await profileClient.updateIdentity({
        businessName: value.trim(),
      });
      ctx.patchSnap({
        identity: { ...(ctx.snap.identity ?? {}), ...updated },
      });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.businessName.question")}
      why={t("welcome.businessName.why")}
    >
      <input
        class="welcome__input"
        type="text"
        autoComplete="organization"
        enterKeyHint="go"
        aria-label={t("welcome.businessName.question")}
        placeholder={t("welcome.businessName.placeholder")}
        value={value}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) => setValue(e.currentTarget.value)}
        // deno-lint-ignore no-explicit-any
        onKeyDown={(e: any) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailStep({ ctx }: { ctx: StepCtx }) {
  const [value, setValue] = useState(ctx.snap.user.email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const trimmed = value.trim();
  const formatBad = trimmed.length > 0 && !EMAIL_RE.test(trimmed);
  const valid = EMAIL_RE.test(trimmed);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await profileClient.updateUser({ email: trimmed });
      ctx.patchSnap({ user: { ...ctx.snap.user, email: updated.email } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.email.question")}
      why={t("welcome.email.why")}
    >
      <input
        class="welcome__input"
        type="email"
        autoComplete="email"
        inputMode="email"
        enterKeyHint="go"
        aria-label={t("welcome.email.question")}
        placeholder={t("welcome.email.placeholder")}
        aria-invalid={formatBad}
        value={value}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) => setValue(e.currentTarget.value)}
        // deno-lint-ignore no-explicit-any
        onKeyDown={(e: any) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      {formatBad
        ? (
          <p class="welcome__error" role="alert">
            {t("welcome.email.invalid")}
          </p>
        )
        : null}
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

function StateStep({ ctx }: { ctx: StepCtx }) {
  const current = ctx.snap.address?.state ?? "";
  const suggestion = ctx.suggestedState ?? "";
  const [selected, setSelected] = useState(current || suggestion);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Show the tap-to-confirm banner when we have a guess and the user hasn't
  // yet picked past it. Once they open the picker, show the full grid.
  const [picking, setPicking] = useState(!suggestion && !current);
  const [query, setQuery] = useState("");
  const valid = Boolean(selected);

  const filtered = US_STATE_OPTIONS.filter((o) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return o.name.toLowerCase().includes(q) || o.code.toLowerCase() === q;
  });

  async function save(code: string = selected) {
    if (!code || busy) return;
    setBusy(true);
    setErr("");
    try {
      // Merge into the existing address — read current values, send them back
      // with the new state so street/city/zip are never clobbered.
      const cur = ctx.snap.address ?? ({} as BusinessAddress);
      const updated = await profileClient.updateAddress({
        street: cur.street,
        unit: cur.unit,
        city: cur.city,
        postal: cur.postal,
        country: cur.country,
        state: code,
      });
      ctx.patchSnap({ address: { ...(ctx.snap.address ?? {}), ...updated } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.state.question")}
      why={t("welcome.state.why")}
    >
      {suggestion && !picking
        ? (
          <div class="welcome__confirm">
            <p class="welcome__confirm-lede">
              {t("welcome.state.guess", { stateName: stateName(suggestion) })}
            </p>
            <div class="welcome__confirm-actions">
              <button
                type="button"
                class="welcome__btn welcome__btn--primary"
                disabled={busy}
                onClick={() => {
                  setSelected(suggestion);
                  // Save with the explicit code — `selected` state hasn't
                  // flushed yet, so pass the suggestion directly.
                  save(suggestion);
                }}
              >
                {t("welcome.state.confirm", {
                  stateName: stateName(suggestion),
                })}
              </button>
              <button
                type="button"
                class="welcome__btn welcome__btn--ghost"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                {t("welcome.state.pickAnother")}
              </button>
            </div>
          </div>
        )
        : (
          <>
            <input
              class="welcome__input"
              type="text"
              enterKeyHint="search"
              aria-label={t("welcome.state.searchLabel")}
              placeholder={t("welcome.state.searchLabel")}
              value={query}
              // deno-lint-ignore no-explicit-any
              onInput={(e: any) => setQuery(e.currentTarget.value)}
            />
            <div class="welcome__chip-grid" role="listbox">
              {filtered.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={selected === o.code}
                  class={"welcome__chip" +
                    (selected === o.code ? " welcome__chip--on" : "")}
                  onClick={() => setSelected(o.code)}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </>
        )}
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      {
        /* P-54: the footer (Back + Skip) renders in BOTH the tap-to-confirm
          banner mode and the full picker mode — the state step offers Back
          and Skip like every other step. UX-11: in banner mode the "Sí,
          {state}" button IS the primary, so the footer Continue steps aside
          (one solid primary per card). */
      }
      <StepFooter
        ctx={ctx}
        valid={valid}
        busy={busy}
        onContinue={save}
        hideContinue={Boolean(suggestion) && !picking}
      />
    </StepBody>
  );
}

function AddressStep({ ctx }: { ctx: StepCtx }) {
  const a = ctx.snap.address ?? ({} as BusinessAddress);
  const [street, setStreet] = useState(a.street ?? "");
  const [unit, setUnit] = useState(a.unit ?? "");
  const [city, setCity] = useState(a.city ?? "");
  const [postal, setPostal] = useState(a.postal ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = street.trim().length > 0 || city.trim().length > 0 ||
    postal.trim().length > 0;

  // Mapbox autocomplete on the street input. The typed text is ALWAYS the
  // first option so a PO box, "misma dirección que arriba", or any address
  // Mapbox doesn't know stays enterable. Suggestions are a convenience —
  // failures just mean an empty list.
  const [sugs, setSugs] = useState<AddressSuggestion[]>([]);
  const [acOpen, setAcOpen] = useState(false);
  const acTimer = useRef<number | undefined>(undefined);
  const acAbort = useRef<AbortController | null>(null);

  function onStreetInput(value: string) {
    setStreet(value);
    clearTimeout(acTimer.current);
    acAbort.current?.abort();
    if (value.trim().length < 3) {
      setSugs([]);
      setAcOpen(false);
      return;
    }
    setAcOpen(true);
    acTimer.current = setTimeout(async () => {
      const ac = new AbortController();
      acAbort.current = ac;
      try {
        // P-38: bias + filter suggestions to the state the user confirmed
        // one step earlier (PUT /profile/address) so "1600 Congress" with
        // TX on record suggests Austin, not Chicago.
        const found = await suggestAddresses(value, {
          lang: langSignal.value,
          state: ctx.snap.address?.state,
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setSugs(found);
      } catch {
        // Aborted by newer keystroke — the newer request owns the list.
      }
    }, 250) as unknown as number;
  }

  function pickSuggestion(s: AddressSuggestion) {
    setStreet(s.street);
    if (s.city) setCity(s.city);
    if (s.postal) setPostal(s.postal);
    setSugs([]);
    setAcOpen(false);
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const cur = ctx.snap.address ?? ({} as BusinessAddress);
      const updated = await profileClient.updateAddress({
        state: cur.state,
        country: cur.country,
        street: street.trim() || undefined,
        unit: unit.trim() || undefined,
        city: city.trim() || undefined,
        postal: postal.trim() || undefined,
      });
      ctx.patchSnap({ address: { ...(ctx.snap.address ?? {}), ...updated } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.address.question")}
      why={t("welcome.address.why")}
    >
      <div class="welcome__ac">
        <input
          class="welcome__input"
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={acOpen}
          aria-controls="welcome-ac-list"
          aria-label={t("welcome.address.street")}
          placeholder={t("welcome.address.street")}
          value={street}
          // deno-lint-ignore no-explicit-any
          onInput={(e: any) => onStreetInput(e.currentTarget.value)}
          // deno-lint-ignore no-explicit-any
          onKeyDown={(e: any) => {
            if (e.key === "Escape") setAcOpen(false);
          }}
          onBlur={() => setAcOpen(false)}
        />
        {acOpen && street.trim().length >= 3
          ? (
            <ul
              id="welcome-ac-list"
              class="welcome__ac-list"
              role="listbox"
              // Options select on mousedown-preventDefault + click so the
              // input's blur (which closes the list) never wins the race.
              // deno-lint-ignore no-explicit-any
              onMouseDown={(e: any) => e.preventDefault()}
            >
              <li role="option" aria-selected={false}>
                <button
                  type="button"
                  class="welcome__ac-opt welcome__ac-opt--custom"
                  onClick={() => {
                    setSugs([]);
                    setAcOpen(false);
                  }}
                >
                  <span class="welcome__ac-text">{street.trim()}</span>
                  <span class="welcome__ac-hint">
                    {t("welcome.address.useTyped")}
                  </span>
                </button>
              </li>
              {sugs.map((s) => (
                <li key={s.label} role="option" aria-selected={false}>
                  <button
                    type="button"
                    class="welcome__ac-opt"
                    onClick={() =>
                      pickSuggestion(s)}
                  >
                    <span class="welcome__ac-text">{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
          : null}
      </div>
      <input
        class="welcome__input"
        type="text"
        autoComplete="address-line2"
        aria-label={t("welcome.address.unit")}
        placeholder={t("welcome.address.unit")}
        value={unit}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) => setUnit(e.currentTarget.value)}
      />
      <div class="welcome__row">
        <input
          class="welcome__input"
          type="text"
          autoComplete="address-level2"
          aria-label={t("welcome.address.city")}
          placeholder={t("welcome.address.city")}
          value={city}
          // deno-lint-ignore no-explicit-any
          onInput={(e: any) => setCity(e.currentTarget.value)}
        />
        <input
          class="welcome__input welcome__input--zip"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          aria-label={t("welcome.address.zip")}
          placeholder={t("welcome.address.zip")}
          value={postal}
          // deno-lint-ignore no-explicit-any
          onInput={(e: any) => setPostal(e.currentTarget.value)}
        />
      </div>
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

const PAYMENT_METHODS: {
  id: "venmo" | "zelle" | "cashapp" | "check" | "cash" | "ach";
  handleField?: "handle" | "cashtag";
}[] = [
  { id: "venmo", handleField: "handle" },
  { id: "zelle", handleField: "handle" },
  { id: "cashapp", handleField: "cashtag" },
  { id: "check" },
  { id: "cash" },
  { id: "ach" },
];

function PaymentStep({ ctx }: { ctx: StepCtx }) {
  const cur = ctx.snap.identity?.acceptedPaymentMethods ?? {};
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const m of PAYMENT_METHODS) o[m.id] = Boolean(cur[m.id]?.enabled);
    return o;
  });
  const [handles, setHandles] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const m of PAYMENT_METHODS) {
      const entry = cur[m.id] as
        | { handle?: string; cashtag?: string }
        | undefined;
      o[m.id] =
        (m.handleField === "cashtag" ? entry?.cashtag : entry?.handle) ??
          "";
    }
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Valid when at least one method is on, and every handle-requiring method
  // that's on has a non-empty handle.
  const anyOn = PAYMENT_METHODS.some((m) => enabled[m.id]);
  const handlesOk = PAYMENT_METHODS.every((m) =>
    !m.handleField || !enabled[m.id] || handles[m.id].trim().length > 0
  );
  const valid = anyOn && handlesOk;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      // Read-modify-write the whole map so methods enabled elsewhere (paypal,
      // card, ...) survive. Only the six chips here are overwritten.
      const next: Record<string, unknown> = {
        ...(ctx.snap.identity?.acceptedPaymentMethods ?? {}),
      };
      for (const m of PAYMENT_METHODS) {
        if (enabled[m.id]) {
          const entry: Record<string, unknown> = { enabled: true };
          if (m.handleField && handles[m.id].trim()) {
            entry[m.handleField] = handles[m.id].trim();
          }
          next[m.id] = entry;
        } else if (next[m.id]) {
          next[m.id] = { ...(next[m.id] as object), enabled: false };
        }
      }
      const updated = await profileClient.updateIdentity({
        acceptedPaymentMethods: next,
      });
      ctx.patchSnap({ identity: { ...(ctx.snap.identity ?? {}), ...updated } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.payment.question")}
      why={t("welcome.payment.why")}
    >
      <div class="welcome__pay">
        {PAYMENT_METHODS.map((m) => (
          <div key={m.id} class="welcome__pay-method">
            <button
              type="button"
              class={"welcome__chip" +
                (enabled[m.id] ? " welcome__chip--on" : "")}
              aria-pressed={enabled[m.id]}
              onClick={() =>
                setEnabled((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
            >
              {t(`welcome.payment.method.${m.id}`)}
            </button>
            {m.handleField && enabled[m.id]
              ? (
                <input
                  class="welcome__input welcome__input--handle"
                  type="text"
                  aria-label={t(`welcome.payment.handle.${m.id}`)}
                  placeholder={t(`welcome.payment.handle.${m.id}`)}
                  value={handles[m.id]}
                  // deno-lint-ignore no-explicit-any
                  onInput={(e: any) =>
                    setHandles((prev) => ({
                      ...prev,
                      [m.id]: e.currentTarget.value,
                    }))}
                />
              )
              : null}
          </div>
        ))}
      </div>
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

function LogoStep({ ctx }: { ctx: StepCtx }) {
  const [preview, setPreview] = useState<string>(
    ctx.snap.identity?.logoUrl ?? "",
  );
  const [fileId, setFileId] = useState<string>(
    ctx.snap.identity?.logoFileId ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = Boolean(fileId);

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setErr("");
    try {
      const rec = await filesClient.uploadBlob(file, file.name);
      setFileId(rec.id);
      setPreview(URL.createObjectURL(file));
    } catch {
      setErr(t("welcome.logo.error"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await profileClient.updateIdentity({
        logoFileId: fileId,
      });
      ctx.patchSnap({ identity: { ...(ctx.snap.identity ?? {}), ...updated } });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.logo.question")}
      why={t("welcome.logo.why")}
    >
      <label class="welcome__upload">
        {preview
          ? (
            <img
              class="welcome__logo-preview"
              src={preview}
              alt={t("welcome.logo.previewAlt")}
            />
          )
          : <span class="welcome__upload-cta">{t("welcome.logo.choose")}</span>}
        <input
          class="welcome__file-input"
          type="file"
          accept="image/*"
          // deno-lint-ignore no-explicit-any
          onChange={(e: any) => onFile(e.currentTarget.files?.[0])}
        />
      </label>
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

function InsuranceStep({ ctx }: { ctx: StepCtx }) {
  const [provider, setProvider] = useState(ctx.snap.insurance?.provider ?? "");
  const [policyNumber, setPolicyNumber] = useState(
    ctx.snap.insurance?.policyNumber ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = provider.trim().length > 0;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const updated = await profileClient.updateInsurance({
        provider: provider.trim(),
        policyNumber: policyNumber.trim() || undefined,
      });
      ctx.patchSnap({
        insurance: { ...(ctx.snap.insurance ?? {}), ...updated },
      });
      ctx.advance();
    } catch {
      setErr(t("welcome.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepBody
      question={t("welcome.insurance.question")}
      why={t("welcome.insurance.why")}
    >
      <input
        class="welcome__input"
        type="text"
        aria-label={t("welcome.insurance.provider")}
        placeholder={t("welcome.insurance.provider")}
        value={provider}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) => setProvider(e.currentTarget.value)}
      />
      <input
        class="welcome__input"
        type="text"
        aria-label={t("welcome.insurance.policy")}
        placeholder={t("welcome.insurance.policy")}
        value={policyNumber}
        // deno-lint-ignore no-explicit-any
        onInput={(e: any) => setPolicyNumber(e.currentTarget.value)}
      />
      {err ? <p class="welcome__error" role="alert">{err}</p> : null}
      <StepFooter ctx={ctx} valid={valid} busy={busy} onContinue={save} />
    </StepBody>
  );
}

// ---------------------------------------------------------------------------
// Step registry — build order lives here. Add steps without touching the
// engine below.
// ---------------------------------------------------------------------------

function MeetBossieStep({ ctx }: { ctx: StepCtx }) {
  return (
    <StepBody
      question={t("welcome.meetBossie.question")}
      why={t("welcome.meetBossie.why")}
    >
      <div class="welcome__cards">
        {EXAMPLE_PROMPTS.map((ex) => (
          <div key={ex.id} class="welcome__card-example">
            <span class="welcome__card-label">{t(ex.labelKey)}</span>
            <span class="welcome__card-text">"{t(ex.textKey)}"</span>
          </div>
        ))}
      </div>
      <StepFooter ctx={ctx} valid busy={false} onContinue={ctx.advance} />
    </StepBody>
  );
}

function SampleQuoteStep({ ctx }: { ctx: StepCtx }) {
  const [busy, setBusy] = useState(false);
  const quoteId = ctx.sampleQuoteId;

  // Final step: Continue marks onboarding finished and lands the user on the
  // assistant's NEW-chat view (/assistant renders an empty conversation) —
  // deliberately NOT a pre-seeded conversation, so their first message starts
  // a fresh thread.
  async function finish() {
    if (busy) return;
    setBusy(true);
    await markOnboardedFinish();
    globalThis.location.href = "/assistant";
  }

  return (
    <StepBody
      question={t("welcome.sample.question")}
      why={t("welcome.sample.why")}
    >
      {quoteId
        ? (
          <>
            <div class="welcome__sample-frame-wrap">
              <iframe
                class="welcome__sample-frame"
                src={`/q/${quoteId}`}
                title={t("welcome.sample.question")}
              />
            </div>
            <a
              class="welcome__sample-link"
              href={`/q/${quoteId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("welcome.sample.openFull")} ↗
            </a>
          </>
        )
        : ctx.sampleQuoteFailed
        ? (
          <>
            <p class="welcome__error" role="alert">
              {t("welcome.sample.error")}
            </p>
            <button
              type="button"
              class="welcome__btn welcome__btn--outline"
              onClick={ctx.retrySampleQuote}
            >
              {t("welcome.sample.retry")}
            </button>
          </>
        )
        : (
          <p class="welcome__sample-loading">
            {t("welcome.sample.loading")}
          </p>
        )}
      <StepFooter ctx={ctx} valid busy={busy} onContinue={finish} />
    </StepBody>
  );
}

function paymentComplete(identity: BusinessIdentity | null): boolean {
  const m = identity?.acceptedPaymentMethods ?? {};
  return Object.values(m).some((v) => v?.enabled);
}

function buildSteps(): StepDef[] {
  return [
    {
      id: "name",
      skippable: false,
      isComplete: (s) => !isPlaceholderName(s.user.name),
      Component: NameStep,
    },
    {
      id: "businessName",
      skippable: true,
      isComplete: (s) => Boolean(s.identity?.businessName?.trim()),
      Component: BusinessNameStep,
    },
    {
      id: "email",
      skippable: true,
      isComplete: (s) => Boolean(s.user.email?.trim()),
      Component: EmailStep,
    },
    {
      id: "state",
      // P-54: skippable like every other data step — skip advances without
      // saving a state, exactly like skipping business name or email.
      skippable: true,
      isComplete: (s) => Boolean(s.address?.state),
      Component: StateStep,
    },
    {
      id: "address",
      skippable: true,
      isComplete: (s) => Boolean(s.address?.street?.trim()),
      Component: AddressStep,
    },
    {
      id: "payment",
      skippable: true,
      isComplete: (s) => paymentComplete(s.identity),
      Component: PaymentStep,
    },
    {
      id: "logo",
      skippable: true,
      isComplete: (s) => Boolean(s.identity?.logoFileId),
      Component: LogoStep,
    },
    {
      id: "insurance",
      skippable: true,
      isComplete: (s) => Boolean(s.insurance?.provider?.trim()),
      Component: InsuranceStep,
    },
    // Education — always shown (isComplete: false) so a data-complete user
    // still gets the teach screens. The sample-quote step is the last one:
    // its Continue finishes onboarding and hands off to the assistant chat.
    {
      id: "meetBossie",
      skippable: false,
      isComplete: () => false,
      Component: MeetBossieStep,
    },
    {
      id: "sampleQuote",
      skippable: false,
      isComplete: () => false,
      Component: SampleQuoteStep,
    },
  ];
}

function firstIncomplete(steps: StepDef[], snap: ProfileSnapshot): number {
  const i = steps.findIndex((step) => !step.isComplete(snap));
  return i === -1 ? Math.max(0, steps.length - 1) : i;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export default function WelcomeWizard(
  { snapshot, suggestedState, initialLang }: Props,
) {
  const steps = useMemo(() => buildSteps(), []);
  const [snap, setSnap] = useState<ProfileSnapshot>(snapshot);
  const [index, setIndex] = useState(() => firstIncomplete(steps, snapshot));
  const [, force] = useState(0);

  // Pre-generate the sample quote while the user fills the form so the
  // "see what your customer sees" step renders instantly. Idempotent
  // server-side (per-user tag), and the public page loads branding live,
  // so business name / logo entered on later steps still show up.
  const [sampleQuoteId, setSampleQuoteId] = useState("");
  const [sampleQuoteFailed, setSampleQuoteFailed] = useState(false);
  const samplePending = useRef(false);
  function ensureSampleQuote() {
    if (samplePending.current || sampleQuoteId) return;
    samplePending.current = true;
    setSampleQuoteFailed(false);
    api.post<{ quoteId: string; created: boolean }>(
      "/agents/conversations/sample-quote",
      {},
    )
      .then((r) => setSampleQuoteId(r.quoteId))
      .catch(() => setSampleQuoteFailed(true))
      .finally(() => {
        samplePending.current = false;
      });
  }
  useEffect(() => {
    ensureSampleQuote();
  }, []);

  // Seed the client language, then re-render whenever the language toggles.
  //
  // `initialLang` is authoritative here: welcome.tsx derives it SSR-side from
  // the account's saved `user.language` first (then a deliberate pm_lang
  // cookie, then Accept-Language), so it already reflects any real prior
  // choice. It MUST win over localStorage["pm:lang"] — lib/lang.ts's
  // module-load seed writes a *defaulted* "en" there on a fresh session (no
  // ?lang=, no prior storage), and reading that back first would clobber an
  // es-language account's wizard into English. Persist the resolved value so
  // the cookie/localStorage agree and other pages render the same language.
  useEffect(() => {
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    const resolved = initialLang ?? snapshot.user.language ?? stored ?? "en";
    langSignal.value = resolved;
    persistLang(resolved);
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    return () => unsub();
  }, []);

  const total = steps.length;
  const step = steps[index];
  const StepComp = step.Component;

  const ctx: StepCtx = {
    snap,
    suggestedState,
    patchSnap: (partial) => setSnap((prev) => ({ ...prev, ...partial })),
    advance: () => setIndex((i) => Math.min(i + 1, total - 1)),
    goBack: () => setIndex((i) => Math.max(i - 1, 0)),
    canGoBack: index > 0,
    skippable: step.skippable,
    index,
    total,
    sampleQuoteId,
    sampleQuoteFailed,
    retrySampleQuote: ensureSampleQuote,
  };

  const [leaving, setLeaving] = useState(false);
  async function skipSetup() {
    if (leaving) return;
    setLeaving(true);
    // Mark onboarding done (skipped) then leave — permanent, no re-trap.
    await fetch("/api/me/onboarded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ skipped: true }),
    }).catch(() => {});
    globalThis.location.href = "/dashboard";
  }

  return (
    <div class="welcome">
      <div class="welcome__progress-wrap">
        <div
          class="welcome__progressbar"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-valuetext={t("welcome.stepOf", {
            current: index + 1,
            total,
          })}
          aria-label={t("welcome.progressAria")}
        >
          <div
            class="welcome__progressbar-fill"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
        <span class="welcome__step-count">
          {t("welcome.stepOf", { current: index + 1, total })}
        </span>
      </div>

      <div class="welcome__card">
        <StepComp key={step.id} ctx={ctx} />
      </div>

      <button
        type="button"
        class="welcome__escape"
        onClick={skipSetup}
        disabled={leaving}
      >
        {t("welcome.skipSetup")}
      </button>
    </div>
  );
}
