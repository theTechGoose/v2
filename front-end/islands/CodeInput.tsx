import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, langSignal, STRINGS } from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";
import { verifyClient } from "../clients/verify.ts";

interface Props {
  phoneNumber: string;
  initialLang?: Lang;
  /** P-39: where "Wrong number? Edit" returns to — the phone form the user
   *  actually came from (e.g. "/landing#trial"). Defaults to "/". */
  editHref?: string;
}

const SLOT_COUNT = 6;

export default function CodeInput(
  { phoneNumber, initialLang, editHref }: Props,
) {
  // Single ref holding the slot inputs (a callback ref fills the array) —
  // calling useRef inside a loop would violate the rules of hooks.
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(Array(SLOT_COUNT).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<
    "verify.errInvalid" | "verify.errExpired" | "verify.errRate" | null
  >(null);
  const [shake, setShake] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /** REQ-039 (NW-52): the number belongs to a closed account — the person
   *  chooses recover / start fresh; nothing signed in on its own. */
  const [recovery, setRecovery] = useState<{ token: string } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    // initialLang (SSR-resolved from the pm_lang cookie / Accept-Language) wins
    // over localStorage: lib/lang.ts's module-load seed writes a *defaulted*
    // "es" into pm:lang on a fresh session, and reading that back first would
    // clobber a page the server rendered in English. See project_langsignal.
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = initialLang ?? stored ?? "es";
    refs.current[0]?.focus();
    const unsub = langSignal.subscribe(() => force((n) => n + 1));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const lang = langSignal.value;
  const s = STRINGS[lang];

  function setSlot(i: number, val: string) {
    const digitsOnly = val.replace(/\D/g, "");
    // Multi-digit input — iOS SMS autofill, Android one-time-code suggestion,
    // or a plain paste that bypasses the paste handler. Spread the digits
    // across the remaining slots starting at i, focus the last filled box,
    // and auto-submit if we've completed the full code.
    if (digitsOnly.length > 1) {
      setDigits((prev) => {
        const next = prev.slice();
        for (let k = 0; k < digitsOnly.length && i + k < SLOT_COUNT; k++) {
          next[i + k] = digitsOnly[k];
        }
        return next;
      });
      const lastIdx = Math.min(i + digitsOnly.length - 1, SLOT_COUNT - 1);
      refs.current[lastIdx]?.focus();
      if (i + digitsOnly.length >= SLOT_COUNT) {
        submit(digitsOnly.slice(0, SLOT_COUNT));
      }
      return;
    }
    const v = digitsOnly.slice(-1);
    setDigits((prev) => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });
    if (v && i < SLOT_COUNT - 1) refs.current[i + 1]?.focus();
    if (v && i === SLOT_COUNT - 1) submit([...digits.slice(0, i), v].join(""));
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "")
      .slice(0, SLOT_COUNT);
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = pasted.padEnd(SLOT_COUNT, "").split("").slice(0, SLOT_COUNT);
    setDigits(next);
    refs.current[Math.min(pasted.length, SLOT_COUNT - 1)]?.focus();
    if (pasted.length === SLOT_COUNT) submit(pasted);
  }

  function onKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  async function submit(code?: string) {
    const finalCode = code ?? digits.join("");
    if (finalCode.length !== SLOT_COUNT) return;
    setSubmitting(true);
    setErrorKey(null);
    try {
      const result = await verifyClient.verifyOtp({
        phoneNumber,
        code: finalCode,
      });
      if (result.ok && "recoverable" in result) {
        setRecovery({ token: result.recoveryToken });
        return;
      }
      if (result.ok) {
        // Persist the verified phone for next-visit one-tap login.
        try {
          globalThis.localStorage?.setItem("pm:last-phone", phoneNumber);
        } catch { /* SSR-safe */ }
        // Animate Step 3 ("You're in") fill before navigating — visual
        // continuity with the landing-page progress bar.
        const codeStep = document.getElementById("pm-step-code");
        const inStep = document.getElementById("pm-step-in");
        const bar2 = document.getElementById("pm-step-bar-2");
        if (codeStep && inStep) {
          codeStep.classList.remove("pm-steps__item--active");
          codeStep.classList.add("pm-steps__item--done");
          const codeDot = codeStep.querySelector(".pm-steps__dot");
          if (codeDot) codeDot.textContent = "✓";
          if (bar2) bar2.classList.add("pm-steps__bar--done");
          inStep.classList.add("pm-steps__item--active");
          const inDot = inStep.querySelector(".pm-steps__dot");
          if (inDot) inDot.textContent = "✓";
        }
        setTimeout(() => {
          globalThis.location.href = result.redirectTo;
        }, 400);
        return;
      }
      const map = {
        invalid_code: "verify.errInvalid",
        expired: "verify.errExpired",
        rate_limited: "verify.errRate",
      } as const;
      setErrorKey(map[result.error]);
      setShake(true);
      setTimeout(() => setShake(false), 380);
      setDigits(Array(SLOT_COUNT).fill(""));
      refs.current[0]?.focus();
    } catch {
      setErrorKey("verify.errInvalid");
    } finally {
      setSubmitting(false);
    }
  }

  /** REQ-039: recover the closed account, or start fresh on the number. */
  async function chooseRecovery(mode: "recover" | "fresh") {
    if (!recovery || recovering) return;
    setRecovering(true);
    setErrorKey(null);
    try {
      const res = mode === "recover"
        ? await verifyClient.recover(recovery.token)
        : await verifyClient.startFresh(recovery.token);
      globalThis.location.href = res.redirectTo;
    } catch {
      setRecovery(null);
      setErrorKey("verify.errExpired");
    } finally {
      setRecovering(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setCooldown(30);
    setErrorKey(null);
    try {
      await verifyClient.resendOtp({ phoneNumber, language: lang });
    } catch { /* keep cooldown */ }
  }

  return (
    <>
      <div class={`code-input ${shake ? "shake" : ""}`} onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={d}
            onInput={(e) => setSlot(i, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            aria-label={t("verify.digitLabel", { n: i + 1 })}
          />
        ))}
      </div>
      {recovery
        ? (
          <div class="pm-recover" data-cy="recover-choice" role="group">
            <p class="pm-recover__title">{s["verify.recoverTitle"]}</p>
            <p class="pm-recover__body">{s["verify.recoverBody"]}</p>
            <div class="pm-recover__actions">
              <button
                type="button"
                class="btn btn-primary"
                data-cy="recover-account"
                disabled={recovering}
                onClick={() => void chooseRecovery("recover")}
              >
                {s["verify.recoverAccount"]}
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                data-cy="start-fresh"
                disabled={recovering}
                onClick={() => void chooseRecovery("fresh")}
              >
                {s["verify.startFresh"]}
              </button>
            </div>
          </div>
        )
        : null}
      {errorKey
        ? <p class="error" role="alert">{s[errorKey] as string}</p>
        : null}
      <button
        class="btn btn-primary btn-lg"
        type="button"
        disabled={submitting || digits.join("").length !== SLOT_COUNT}
        onClick={() => submit()}
      >
        {submitting ? t("verify.busy") : s["verify.cta"]}
      </button>
      <div class="meta">
        <a href={editHref ?? "/"}>{s["verify.editPhone"]}</a>
        <button type="button" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0
            ? s["verify.resendIn"].replace("{n}", String(cooldown))
            : s["verify.resend"]}
        </button>
      </div>
    </>
  );
}
