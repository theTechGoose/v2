/**
 * REQ-920b — "Text under DocuMonster's own registration": a super admin's bought number moves to
 * the platform's main Twilio account and joins a messaging service whose A2P campaign is verified,
 * so it may text at once instead of registering a brand of its own. Renders nothing for anyone the
 * API answers 403 to (not a super admin). Once adopted, the line shows what it texts through.
 */
import { useEffect, useState } from "preact/hooks";
import {
  commsClient,
  type HouseService,
} from "../../clients/communications.ts";
import { ApiError } from "../../lib/api.ts";
import { t } from "../../lib/i18n.ts";

interface LineLike {
  kind?: string;
  messagingServiceSid?: string;
  campaignUsecase?: string;
}

export default function HouseLinePanel(
  { line, onChanged }: {
    line: LineLike;
    onChanged: () => Promise<void> | void;
  },
) {
  const [services, setServices] = useState<HouseService[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (line.kind === "main") return;
    commsClient.houseServices()
      .then((r) => {
        setServices(r.services);
        if (r.services[0]) setPick(r.services[0].sid);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setAllowed(false);
        else setErr(friendly(e));
      });
  }, [line.kind]);

  if (!allowed) return null;

  if (line.kind === "main") {
    return (
      <section class="panel comms-house" data-cy="comms-house">
        <span class="chip chip--green" data-cy="comms-house-registered">
          {t("comms.house.registered", { usecase: line.campaignUsecase ?? "" })}
        </span>
        <span class="hint">{t("comms.house.registeredHint")}</span>
      </section>
    );
  }

  async function adopt() {
    if (!pick) return;
    setBusy(true);
    setErr(null);
    try {
      await commsClient.houseAdopt(pick);
      await onChanged();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="panel comms-house" data-cy="comms-house">
      <h3 class="panel__title">{t("comms.house.title")}</h3>
      <p class="hint">{t("comms.house.sub")}</p>
      {services && services.length === 0 && (
        <p class="hint">{t("comms.house.none")}</p>
      )}
      {services && services.length > 0 && (
        <div class="comms-house__row">
          <select
            value={pick}
            data-cy="comms-house-service"
            disabled={busy}
            onChange={(e) => setPick((e.target as HTMLSelectElement).value)}
          >
            {services.map((s) => (
              <option value={s.sid} key={s.sid}>
                {s.friendlyName} · {s.usecase}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn btn--teal btn--sm"
            data-cy="comms-house-adopt"
            disabled={busy || !pick}
            onClick={adopt}
          >
            {busy ? t("comms.house.adopting") : t("comms.house.adopt")}
          </button>
        </div>
      )}
      <p class="hint">{t("comms.house.note")}</p>
      {err && <p class="alert" data-cy="comms-house-err">{err}</p>}
    </section>
  );
}

function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body && typeof e.body === "object"
      ? e.body as { code?: unknown; message?: unknown }
      : {};
    if (body.code === "already_house") return t("comms.house.already");
    if (body.code === "service_not_verified") {
      return t("comms.house.notVerified");
    }
    if (e.status === 502) {
      return t("comms.house.twilioFailed", { msg: String(body.message ?? "") });
    }
  }
  return t("comms.err.generic");
}
