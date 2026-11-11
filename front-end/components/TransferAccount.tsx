import { useState } from "preact/hooks";
import { ApiError } from "../lib/api.ts";
import { profileClient } from "../clients/profile.ts";
import { fmtPhone } from "../lib/format.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

/**
 * REQ-220 — "Transfer account", the button next to the phone on Settings and its dialog.
 *
 * The phone is the account's sign-in, so it is not a field: it moves in two steps. (1) the new
 * owner's number — the server texts THAT number a code; (2) the code, typed back here. A right
 * code moves the account onto the new number and signs this browser out (/login). Rendered by
 * the Settings island only, and never for an admin acting for the account (the server refuses
 * them with 403 as well).
 */
const input =
  "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border, #d8dcd5);border-radius:8px;font:inherit;font-size:15px;background:#fff;color:var(--fg)";
const label =
  "display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted, #6b7560);margin-bottom:4px";
const ghost =
  "padding:9px 14px;border-radius:8px;border:0;background:transparent;color:var(--fg-muted,#6b7560);cursor:pointer;font:inherit;font-weight:600";
const solid = (color: string, on: boolean) =>
  `padding:9px 16px;border-radius:8px;border:0;background:${color};opacity:${
    on ? 1 : 0.45
  };color:#fff;cursor:${
    on ? "pointer" : "not-allowed"
  };font:inherit;font-weight:700`;

/** the server's refusal → the line the dialog shows */
const ERROR_KEYS: Record<string, string> = {
  same_number: "settings.transfer.err.same_number",
  phone_taken: "settings.transfer.err.phone_taken",
  bad_phone: "settings.transfer.err.bad_phone",
  cooldown: "settings.transfer.err.cooldown",
  invalid_code: "settings.transfer.err.invalid_code",
  expired: "settings.transfer.err.expired",
  rate_limited: "settings.transfer.err.rate_limited",
  acting_as_admin: "settings.transfer.err.acting_as_admin",
};

function messageFor(lang: Lang, e: unknown): string {
  const body = e instanceof ApiError && e.body && typeof e.body === "object"
    ? e.body as { error?: string; retryAfterSeconds?: number }
    : undefined;
  const key = ERROR_KEYS[body?.error ?? ""];
  return key
    ? tFor(lang, key, { seconds: String(body?.retryAfterSeconds ?? 30) })
    : tFor(lang, "settings.transfer.err.failed");
}

export function TransferAccount({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const phoneOk = phone.replace(/\D/g, "").length >= 10;
  const codeOk = code.replace(/\D/g, "").length === 6;

  function show() {
    setStep("phone");
    setPhone("");
    setSentTo("");
    setDevCode(null);
    setCode("");
    setErr(null);
    setOpen(true);
  }

  async function send() {
    if (!phoneOk || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await profileClient.transferStart(phone);
      setSentTo(r.phoneNumber);
      setDevCode(r.devCode ?? null);
      setCode("");
      setStep("code");
    } catch (e) {
      setErr(messageFor(lang, e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!codeOk || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await profileClient.transferConfirm(code);
      // the account is the new number's now and this session is gone
      globalThis.location.href = "/login";
    } catch (e) {
      setErr(messageFor(lang, e));
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-cy="transfer-open"
        onClick={show}
        style="padding:4px 10px;border-radius:8px;border:1px solid var(--border, #d8dcd5);background:#fff;color:var(--fg);cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;white-space:nowrap"
      >
        {tFor(lang, "settings.transfer.button")}
      </button>
      {open
        ? (
          <div
            data-cy="transfer-modal"
            style="position:fixed;inset:0;z-index:60;background:rgba(20,72,82,0.35);display:flex;align-items:center;justify-content:center;padding:20px"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-title"
              style="background:#fff;border-radius:16px;padding:20px 22px;width:min(480px,100%);box-shadow:0 20px 60px rgba(20,72,82,0.25);display:flex;flex-direction:column;gap:12px;text-align:left"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                if (step === "phone") send();
                else confirm();
              }}
            >
              <div
                id="transfer-title"
                style="font-size:18px;font-weight:800;color:var(--fg,#144852)"
              >
                {tFor(lang, "settings.transfer.title")}
              </div>
              {step === "phone"
                ? (
                  <>
                    <p style="margin:0;font-size:13.5px;color:var(--fg,#144852)">
                      {tFor(lang, "settings.transfer.intro")}
                    </p>
                    <label style="display:block">
                      <span style={label}>
                        {tFor(lang, "settings.transfer.phoneLabel")}
                      </span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        data-cy="transfer-phone"
                        style={input}
                        value={phone}
                        disabled={busy}
                        placeholder="(555) 123-4567"
                        onInput={(e) =>
                          setPhone((e.target as HTMLInputElement).value)}
                      />
                    </label>
                  </>
                )
                : (
                  <>
                    <p style="margin:0;font-size:13.5px;color:var(--fg,#144852)">
                      {tFor(lang, "settings.transfer.codeIntro", {
                        phone: fmtPhone(sentTo) || sentTo,
                      })}
                    </p>
                    {devCode
                      ? (
                        <div
                          data-cy="transfer-dev-code"
                          style="padding:8px 12px;border:2px solid #15202b;border-radius:10px;background:#fff7d6;color:#15202b;font-size:13px;font-weight:700"
                        >
                          {tFor(lang, "settings.transfer.devCode", {
                            code: devCode,
                          })}
                        </div>
                      )
                      : null}
                    <label style="display:block">
                      <span style={label}>
                        {tFor(lang, "settings.transfer.codeLabel")}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        data-cy="transfer-code"
                        style={`${input};letter-spacing:.3em;font-variant-numeric:tabular-nums`}
                        value={code}
                        disabled={busy}
                        placeholder="000000"
                        onInput={(e) =>
                          setCode(
                            (e.target as HTMLInputElement).value.replace(
                              /\D/g,
                              "",
                            ),
                          )}
                      />
                    </label>
                    <p style="margin:0;font-size:12.5px;color:#a83b3b;font-weight:600">
                      {tFor(lang, "settings.transfer.warning")}
                    </p>
                  </>
                )}
              {err
                ? (
                  <div
                    data-cy="transfer-error"
                    role="alert"
                    style="color:#a83b3b;font-size:12.5px"
                  >
                    {err}
                  </div>
                )
                : null}
              <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
                <button
                  type="button"
                  data-cy="transfer-cancel"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  style={ghost}
                >
                  {tFor(lang, "settings.transfer.cancel")}
                </button>
                {step === "phone"
                  ? (
                    <button
                      type="submit"
                      data-cy="transfer-send"
                      disabled={!phoneOk || busy}
                      style={solid(
                        "var(--brand-green,#519843)",
                        phoneOk && !busy,
                      )}
                    >
                      {busy
                        ? tFor(lang, "settings.transfer.sending")
                        : tFor(lang, "settings.transfer.send")}
                    </button>
                  )
                  : (
                    <button
                      type="submit"
                      data-cy="transfer-confirm"
                      disabled={!codeOk || busy}
                      style={solid("#a83b3b", codeOk && !busy)}
                    >
                      {busy
                        ? tFor(lang, "settings.transfer.working")
                        : tFor(lang, "settings.transfer.confirm")}
                    </button>
                  )}
              </div>
            </form>
          </div>
        )
        : null}
    </>
  );
}
