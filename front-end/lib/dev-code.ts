/**
 * REQ-082 — the one hand-over for the dev code between the page that sent it and /verify.
 *
 * The pages that hand off to /verify ("/" through landing-scripts.js, /landing, /login) stash
 * the code the send-otp reply carried on the fakes; /verify's CodeInput takes it on mount — once:
 * taking clears it, so a reload shows no stale code. sessionStorage, so it dies with the tab.
 */
export const DEV_CODE_KEY = "pm:dev-code";

export function stashDevCode(phone: string, code: string | undefined): void {
  try {
    if (code) {
      globalThis.sessionStorage?.setItem(
        DEV_CODE_KEY,
        JSON.stringify({ phone, code }),
      );
    } else globalThis.sessionStorage?.removeItem(DEV_CODE_KEY);
  } catch { /* private mode / SSR */ }
}

export function takeDevCode(phone: string): string | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(DEV_CODE_KEY);
    if (!raw) return null;
    globalThis.sessionStorage?.removeItem(DEV_CODE_KEY);
    const parsed = JSON.parse(raw) as { phone?: string; code?: string };
    return parsed.phone === phone && typeof parsed.code === "string"
      ? parsed.code
      : null;
  } catch {
    return null;
  }
}
