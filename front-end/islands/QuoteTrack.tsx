/**
 * Collapsible track group for the quotes pipeline. Track 1 (Out for response)
 * defaults to open; tracks 2 and 3 collapsed. Open state persists per track in
 * localStorage so contractors who always work on drafts get them open on next
 * visit.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";

interface Props {
  num: string;
  title: string;
  count: number;
  /** Singular word used in the count label ("0 quotes" / "1 quote"). The
   *  component is reused by /invoices and /payments which want different
   *  wording. When omitted, falls back to the localized "quote" unit. */
  unit?: string;
  defaultOpen?: boolean;
  storageKey?: string;
  lang?: "en" | "es";
  children?: ComponentChildren;
}

export default function QuoteTrack(
  {
    num,
    title,
    count,
    unit,
    defaultOpen = true,
    storageKey,
    lang = "en",
    children,
  }: Props,
) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof globalThis.localStorage === "undefined" || !storageKey) {
      return defaultOpen;
    }
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultOpen;
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      globalThis.localStorage?.setItem(storageKey, open ? "1" : "0");
    } catch { /* ignore */ }
  }, [open, storageKey]);

  return (
    <section class={`qtrack ${open ? "" : "qtrack--collapsed"}`}>
      <header class="qtrack__head" onClick={() => setOpen((v) => !v)}>
        <span class="qtrack__chev">
          <I d={ICN.chev} size={14} sw={2.5} />
        </span>
        <span class="qtrack__num">{num}</span>
        <span class="qtrack__title">{title}</span>
        <span class="qtrack__count">
          {unit
            ? `${count} ${count === 1 ? unit : `${unit}s`}`
            : tFor(
              lang,
              `quoteTrack.count.${count === 1 ? "one" : "other"}`,
              { n: count },
            )}
        </span>
      </header>
      <div class="qtrack__body">
        <div class="qtrack__body-inner">
          {children}
        </div>
      </div>
    </section>
  );
}
