/**
 * Live chat header for /assistant. Renders the same DOM shell as the static
 * <ChatHeader /> SSR component, but subscribes to the `pm:asst-header`
 * window event so AsstChat can update the title + status string in place
 * as a conversation forms (P6.12).
 *
 * The toolbar is now a single **universal back button** — it is always
 * shown and simply dispatches `pm:asst-back`; AsstChat decides what "back"
 * means (rewind the active wizard step → pop an in-chat view → leave the
 * chat for the dashboard). The old per-state Share/More buttons were inert
 * and have been removed.
 */
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { langSignal, tFor } from "../lib/i18n.ts";

interface Props {
  initialClient: string;
  initialStatus: string;
  lang?: "en" | "es";
}

interface HeaderEvent {
  client: string;
  status: string;
}

export default function ChatHeaderLive(
  { initialClient, initialStatus }: Props,
) {
  // Self-source the UI language so the header re-renders live when the
  // language flips (Settings). The optional `lang` prop is an ignored SSR seed.
  const lang = langSignal.value;
  const [client, setClient] = useState(initialClient);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<HeaderEvent>).detail;
      if (!detail) return;
      if (typeof detail.client === "string" && detail.client.length > 0) {
        setClient(detail.client);
      }
      if (typeof detail.status === "string" && detail.status.length > 0) {
        setStatus(detail.status);
      }
    }
    globalThis.addEventListener("pm:asst-header", onUpdate);
    return () => {
      globalThis.removeEventListener("pm:asst-header", onUpdate);
    };
  }, []);

  return (
    <div class="chat__head">
      <a
        href="#"
        class="chat__head-btn"
        title={tFor(lang, "common.back")}
        aria-label={tFor(lang, "common.back")}
        style="text-decoration:none"
        onClick={(e) => {
          e.preventDefault();
          globalThis.dispatchEvent(new CustomEvent("pm:asst-back"));
        }}
      >
        <I d={ICN.back} size={15} />
      </a>
      <div class="chat__head-info">
        <div class="chat__head-title">{client}</div>
        <div class="chat__head-sub">
          <span class="chat__head-dot" />
          {status}
        </div>
      </div>
    </div>
  );
}
