/**
 * Collapsible track group for the quotes pipeline. Track 1 (Out for response)
 * defaults to open; tracks 2 and 3 collapsed. Open state persists per track in
 * localStorage so contractors who always work on drafts get them open on next
 * visit.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";

interface Props {
  num: string;
  title: string;
  count: number;
  defaultOpen?: boolean;
  storageKey?: string;
  children?: ComponentChildren;
}

export default function QuoteTrack({ num, title, count, defaultOpen = true, storageKey, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined" || !storageKey) return defaultOpen;
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultOpen;
  });

  useEffect(() => {
    if (!storageKey) return;
    try { globalThis.localStorage?.setItem(storageKey, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open, storageKey]);

  return (
    <section class={`qtrack ${open ? "" : "qtrack--collapsed"}`}>
      <header class="qtrack__head" onClick={() => setOpen((v) => !v)}>
        <span class="qtrack__chev"><I d={ICN.chev} size={14} sw={2.5} /></span>
        <span class="qtrack__num">{num}</span>
        <span class="qtrack__title">{title}</span>
        <span class="qtrack__count">{count} {count === 1 ? "quote" : "quotes"}</span>
      </header>
      <div class="qtrack__body">
        <div class="qtrack__body-inner">
          {children}
        </div>
      </div>
    </section>
  );
}
