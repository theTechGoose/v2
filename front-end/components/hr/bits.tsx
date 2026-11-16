/** REQ-883 — small pieces the HR islands share: the status chip, the API-error → message map, a toast. */
import { useEffect, useState } from "preact/hooks";
import type { HireStatus } from "../../clients/hr.ts";
import { ApiError } from "../../lib/api.ts";
import { STATUS_CHIP } from "../../lib/hr.ts";
import { t } from "../../lib/i18n.ts";

export function StatusChip({ status }: { status: HireStatus }) {
  return (
    <span class={`chip ${STATUS_CHIP[status] ?? ""}`} data-cy="hr-status">
      {t(`hr.status.${status}`)}
    </span>
  );
}

/** the error line for an ApiError: `<prefix>.err.<code>` when the dictionary has it, else the generic one */
export function friendlyHr(e: unknown, prefix: string): string {
  if (e instanceof ApiError) {
    const code = e.body && typeof e.body === "object"
      ? String((e.body as { code?: unknown }).code ?? "")
      : "";
    if (code) {
      const k = `${prefix}.err.${code}`;
      const s = t(k);
      if (s !== k) return s;
    }
  }
  return t("hr.common.error");
}

export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2400);
    return () => clearTimeout(id);
  }, [msg]);
  return [msg, setMsg];
}

export function Toast({ msg }: { msg: string | null }) {
  return msg ? <div class="hr-toast" data-cy="hr-toast">{msg}</div> : null;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span class="hr-progress" data-cy="hr-progress">
      <span class="hr-progress__track">
        <span class="hr-progress__fill" style={`width:${pct}%`} />
      </span>
      {t("hr.hires.progressOf", { done, total })}
    </span>
  );
}
