/**
 * Collapsible track group for the quotes pipeline. Track 1 (Out for response)
 * defaults to open; tracks 2 and 3 collapsed. A user's toggle persists per track
 * in localStorage (never the mount state — REQ-567) so contractors who always work on drafts get them open on next
 * visit.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { tFor } from "../lib/i18n.ts";
import { initialTrackOpen, toggleTrackOpen } from "../lib/track-open.ts";

interface Props {
  num: string;
  title: string;
  count: number;
  /** Singular word used in the count label ("0 quotes" / "1 quote"). The
   *  component is reused by /invoices and /payments which want different
   *  wording. When omitted, falls back to the localized "quote" unit. */
  unit?: string;
  /** REQ-243: badged sample cards shown in the track but not in `count`;
   *  when > 0 the label reads "1 quote + sample". */
  sampleCount?: number;
  defaultOpen?: boolean;
  /** Deep-link override (/quotes?open=<id>): when true the track mounts
   *  expanded regardless of the stored preference, so the opened quote's
   *  card is actually visible. The user can still collapse it. */
  forceOpen?: boolean;
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
    sampleCount = 0,
    defaultOpen = true,
    forceOpen = false,
    storageKey,
    lang = "en",
    children,
  }: Props,
) {
  // REQ-567 (cycle 4, m37): only a user toggle is remembered — a mount never
  // writes, so a visit while the track is empty can't pin it closed.
  const storage = () =>
    typeof globalThis.localStorage === "undefined"
      ? undefined
      : globalThis.localStorage;
  const [open, setOpen] = useState<boolean>(() =>
    initialTrackOpen({ storage: storage(), storageKey, defaultOpen, forceOpen })
  );

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <section class={`qtrack ${open ? "" : "qtrack--collapsed"}`}>
      <header
        class="qtrack__head"
        onClick={() => setOpen(toggleTrackOpen(storage(), storageKey, open))}
      >
        <span class="qtrack__chev">
          <I d={ICN.chev} size={14} sw={2.5} />
        </span>
        <span class="qtrack__num">{num}</span>
        <span class="qtrack__title">{title}</span>
        <span class="qtrack__count">
          {unit ? `${count} ${count === 1 ? unit : `${unit}s`}` : tFor(
            lang,
            `quoteTrack.count.${count === 1 ? "one" : "other"}`,
            { n: count },
          )}
          {sampleCount > 0 && tFor(lang, "quoteTrack.count.plusSample")}
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
