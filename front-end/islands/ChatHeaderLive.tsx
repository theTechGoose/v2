/**
 * Live chat header for /assistant. Renders the same DOM as the static
 * <ChatHeader /> SSR component, but subscribes to the `pm:asst-header`
 * window event so AsstChat can update the title + status string in place
 * as a conversation forms (P6.12).
 *
 * Also listens for `pm:asst-history` events from AsstChat to
 * conditionally show/hide the back button. When history depth > 0 the
 * back anchor pops the most recent snapshot via `pm:asst-back`.
 */
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";

interface Props {
  initialClient: string;
  initialStatus: string;
}

interface HeaderEvent { client: string; status: string }

export default function ChatHeaderLive({ initialClient, initialStatus }: Props) {
  const [client, setClient] = useState(initialClient);
  const [status, setStatus] = useState(initialStatus);
  const [historyDepth, setHistoryDepth] = useState(0);

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
    function onHistory(e: Event) {
      const detail = (e as CustomEvent<{ depth: number }>).detail;
      if (detail && typeof detail.depth === "number") {
        setHistoryDepth(detail.depth);
      }
    }
    globalThis.addEventListener("pm:asst-header", onUpdate);
    globalThis.addEventListener("pm:asst-history", onHistory);
    return () => {
      globalThis.removeEventListener("pm:asst-header", onUpdate);
      globalThis.removeEventListener("pm:asst-history", onHistory);
    };
  }, []);

  return (
    <div class="chat__head">
      {historyDepth > 0 ? (
        <a
          href="#"
          class="chat__head-btn"
          title="Back"
          style="text-decoration:none"
          onClick={(e) => {
            e.preventDefault();
            globalThis.dispatchEvent(new CustomEvent("pm:asst-back"));
          }}
        >
          <I d={ICN.back} size={15} />
        </a>
      ) : null}
      <div class="chat__head-info">
        <div class="chat__head-title">{client}</div>
        <div class="chat__head-sub">
          <span class="chat__head-dot" />
          {status}
        </div>
      </div>
      <div class="chat__head-tools">
        <button type="button" class="chat__head-btn" title="Share thread"><I d={ICN.send} size={15} /></button>
        <button type="button" class="chat__head-btn" title="More"><I d={ICN.more} size={15} /></button>
      </div>
    </div>
  );
}
