/**
 * Live chat header for /assistant. Renders the same DOM as the static
 * <ChatHeader /> SSR component, but subscribes to the `pm:asst-header`
 * window event so AsstChat can update the title + status string in place
 * as a conversation forms (P6.12).
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
    return () => globalThis.removeEventListener("pm:asst-header", onUpdate);
  }, []);

  return (
    <div class="chat__head">
      <a href="/dashboard" class="chat__head-btn" title="Back to dashboard" style="text-decoration:none">
        <I d={ICN.back} size={15} />
      </a>
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
