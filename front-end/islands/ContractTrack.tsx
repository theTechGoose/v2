/**
 * Collapsible track group for the contracts pipeline. Track 1 (In progress)
 * defaults to open; tracks 2 + 3 collapsed. Open state persists per track in
 * localStorage so contractors who always want a specific track open get it.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";

interface Props {
  num:        string;
  title:      string;
  count:      string;
  defaultOpen?: boolean;
  storageKey?: string;
  children?:  ComponentChildren;
}

export default function ContractTrack({ num, title, count, defaultOpen = true, storageKey, children }: Props) {
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
    <section class={`ktrack ${open ? "" : "ktrack--collapsed"}`}>
      <header class="ktrack__head" onClick={() => setOpen((v) => !v)}>
        <span class="ktrack__chev"><I d={ICN.chev} size={14} sw={2.5} /></span>
        <span class="ktrack__num">{num}</span>
        <h2 class="ktrack__title">{title}</h2>
        <span class="ktrack__count">{count}</span>
      </header>
      <div class="ktrack__body">
        <div class="ktrack__body-inner">{children}</div>
      </div>
    </section>
  );
}
