import { useState } from "preact/hooks";
import { normalizeEmail } from "../../shared/quote-flow/normalize-email.ts";
import { langSignal } from "../lib/lang.ts";
import { t } from "../lib/i18n.ts";
import { loginInternalClient } from "../clients/login-internal.ts";
import { ApiError } from "../lib/api.ts";

/**
 * LoginInternalForm (REQ-050) — the email entry of /login-internal: send a
 * code to the address (any well-formed one — the account is found or
 * created when the code comes back), then hand off to /verify-internal for
 * the 6-digit step. The backend's answers are shown by name (closed
 * account, cooldown) — an internal page is allowed to be loud.
 */
const ERROR_KEYS: Record<string, string> = {
  invalid_email: "loginInternal.emailInvalid",
  account_closed: "loginInternal.accountClosed",
  cooldown: "loginInternal.cooldown",
};

export default function LoginInternalForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lang = langSignal.value;

  async function onSubmit(e: Event) {
    e.preventDefault();
    setErr(null);
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setErr(t("loginInternal.emailInvalid"));
      return;
    }
    setSubmitting(true);
    try {
      await loginInternalClient.sendEmailOtp({
        email: normalized,
        language: lang,
      });
      globalThis.location.href = `/verify-internal?email=${
        encodeURIComponent(normalized)
      }&lang=${lang}`;
    } catch (error) {
      const code = error instanceof ApiError
        ? (error.body as { error?: string } | null)?.error ?? ""
        : "";
      setErr(
        code in ERROR_KEYS
          ? t(ERROR_KEYS[code])
          : t("loginInternal.sendFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle =
    "width:100%;box-sizing:border-box;padding:18px 16px;border:2px solid var(--border,#d8dcd5);border-radius:14px;font:inherit;font-weight:700;font-size:20px;text-align:center;background:#fff;color:var(--fg)";

  return (
    <form
      onSubmit={onSubmit}
      style="display:flex;flex-direction:column;gap:14px;text-align:left"
    >
      <label style="display:block">
        <span style="display:block;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560);margin-bottom:6px">
          {t("loginInternal.emailLabel")}
        </span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          placeholder={t("loginInternal.emailPlaceholder")}
          required
          data-cy="internal-email"
          style={inputStyle}
        />
      </label>
      {err
        ? (
          <p
            style="color:#a83b3b;font-size:14px;margin:0"
            role="alert"
            data-cy="internal-error"
          >
            {err}
          </p>
        )
        : null}
      <button
        type="submit"
        disabled={submitting}
        data-cy="internal-submit"
        style="appearance:none;border:0;border-radius:12px;padding:14px 18px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer"
      >
        {submitting ? "…" : t("loginInternal.submit")}
      </button>
      <p style="color:var(--fg-muted,#6b7560);font-size:13px;margin:2px 0 0;text-align:center">
        {t("loginInternal.helper")}
      </p>
    </form>
  );
}
