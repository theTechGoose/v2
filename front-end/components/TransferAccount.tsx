import Backdrop from "./Backdrop.tsx";
import { useState } from "preact/hooks";
import { ApiError } from "../lib/api.ts";
import { profileClient } from "../clients/profile.ts";
import { type Lang, tFor } from "../lib/i18n.ts";

/**
 * REQ-220 — "Transfer account", the button next to the phone on Settings and its dialog.
 *
 * The phone is the account's sign-in, so it is not a field: it moves here. One step (AMENDMENT,
 * 2026-11-11: no code) — the new owner's number and the button. The account moves onto that
 * number and this browser is signed out (/login). Rendered by the Settings island only, and
 * never for an admin acting for the account (the server refuses them with 403 as well).
 */
const input =
  "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border, #d8dcd5);border-radius:8px;font:inherit;font-size:15px;background:#fff;color:var(--fg)";
const label =
  "display:block;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-muted, #6b7560);margin-bottom:4px";
const ghost =
  "padding:9px 14px;border-radius:8px;border:0;background:transparent;color:var(--fg-muted,#6b7560);cursor:pointer;font:inherit;font-weight:600";

/** the server's refusal → the line the dialog shows */
const ERROR_KEYS: Record<string, string> = {
  same_number: "settings.transfer.err.same_number",
  phone_taken: "settings.transfer.err.phone_taken",
  bad_phone: "settings.transfer.err.bad_phone",
  acting_as_admin: "settings.transfer.err.acting_as_admin",
};

function messageFor(lang: Lang, e: unknown): string {
  const body = e instanceof ApiError && e.body && typeof e.body === "object"
    ? e.body as { error?: string }
    : undefined;
  return tFor(
    lang,
    ERROR_KEYS[body?.error ?? ""] ?? "settings.transfer.err.failed",
  );
}

export function TransferAccount({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const phoneOk = phone.replace(/\D/g, "").length >= 10;
  const armed = phoneOk && !busy;

  function show() {
    setPhone("");
    setErr(null);
    setOpen(true);
  }

  async function transfer() {
    if (!armed) return;
    setBusy(true);
    setErr(null);
    try {
      await profileClient.transferAccount(phone);
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
          <Backdrop
            data-cy="transfer-modal"
            style="position:fixed;inset:0;z-index:60;background:rgba(20,72,82,0.35);display:flex;align-items:center;justify-content:center;padding:20px"
            onClose={() => !busy && setOpen(false)}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-title"
              style="background:#fff;border-radius:16px;padding:20px 22px;width:min(480px,100%);box-shadow:0 20px 60px rgba(20,72,82,0.25);display:flex;flex-direction:column;gap:12px;text-align:left"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                transfer();
              }}
            >
              <div
                id="transfer-title"
                style="font-size:18px;font-weight:800;color:var(--fg,#144852)"
              >
                {tFor(lang, "settings.transfer.title")}
              </div>
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
              <p style="margin:0;font-size:12.5px;color:#a83b3b;font-weight:600">
                {tFor(lang, "settings.transfer.warning")}
              </p>
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
                <button
                  type="submit"
                  data-cy="transfer-confirm"
                  disabled={!armed}
                  style={`padding:9px 16px;border-radius:8px;border:0;background:#a83b3b;opacity:${
                    armed ? 1 : 0.45
                  };color:#fff;cursor:${
                    armed ? "pointer" : "not-allowed"
                  };font:inherit;font-weight:700`}
                >
                  {busy
                    ? tFor(lang, "settings.transfer.working")
                    : tFor(lang, "settings.transfer.confirm")}
                </button>
              </div>
            </form>
          </Backdrop>
        )
        : null}
    </>
  );
}
