import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal, STRINGS, type Lang } from "../lib/lang.ts";
import { verifyClient } from "../clients/verify.ts";

interface Props {
  phoneNumber: string;
  initialLang?: Lang;
}

const SLOT_COUNT = 6;

export default function CodeInput({ phoneNumber, initialLang }: Props) {
  const refs = Array.from({ length: SLOT_COUNT }, () => useRef<HTMLInputElement>(null));
  const [digits, setDigits] = useState<string[]>(Array(SLOT_COUNT).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<"verify.errInvalid" | "verify.errExpired" | "verify.errRate" | null>(null);
  const [shake, setShake] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    const stored = globalThis.localStorage?.getItem("pm:lang") as Lang | null;
    langSignal.value = stored ?? initialLang ?? "en";
    refs[0].current?.focus();
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
      refs[lastIdx].current?.focus();
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
    if (v && i < SLOT_COUNT - 1) refs[i + 1].current?.focus();
    if (v && i === SLOT_COUNT - 1) submit([...digits.slice(0, i), v].join(""));
  }

  function onPaste(e: ClipboardEvent) {
    const pasted = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, SLOT_COUNT);
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = pasted.padEnd(SLOT_COUNT, "").split("").slice(0, SLOT_COUNT);
    setDigits(next);
    refs[Math.min(pasted.length, SLOT_COUNT - 1)].current?.focus();
    if (pasted.length === SLOT_COUNT) submit(pasted);
  }

  function onKeyDown(i: number, e: KeyboardEvent) {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs[i - 1].current?.focus();
  }

  async function submit(code?: string) {
    const finalCode = code ?? digits.join("");
    if (finalCode.length !== SLOT_COUNT) return;
    setSubmitting(true);
    setErrorKey(null);
    try {
      const result = await verifyClient.verifyOtp({ phoneNumber, code: finalCode });
      if (result.ok) {
        // Persist the verified phone for next-visit one-tap login.
        try { globalThis.localStorage?.setItem("pm:last-phone", phoneNumber); } catch { /* SSR-safe */ }
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
        setTimeout(() => { globalThis.location.href = result.redirectTo; }, 400);
        return;
      }
      const map = {
        invalid_code: "verify.errInvalid",
        expired:      "verify.errExpired",
        rate_limited: "verify.errRate",
      } as const;
      setErrorKey(map[result.error]);
      setShake(true);
      setTimeout(() => setShake(false), 380);
      setDigits(Array(SLOT_COUNT).fill(""));
      refs[0].current?.focus();
    } catch {
      setErrorKey("verify.errInvalid");
    } finally {
      setSubmitting(false);
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
            ref={refs[i]}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={d}
            onInput={(e) => setSlot(i, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            aria-label={`Digit ${i + 1}`}
          />
        ))}
      </div>
      {errorKey ? <p class="error" role="alert">{s[errorKey] as string}</p> : null}
      <button
        class="btn btn-primary btn-lg"
        type="button"
        disabled={submitting || digits.join("").length !== SLOT_COUNT}
        onClick={() => submit()}
      >
        {submitting ? "…" : s["verify.cta"]}
      </button>
      <div class="meta">
        <a href="/">{s["verify.editPhone"]}</a>
        <button type="button" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0
            ? s["verify.resendIn"].replace("{n}", String(cooldown))
            : s["verify.resend"]}
        </button>
      </div>
    </>
  );
}
