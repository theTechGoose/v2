/**
 * MoneyInput — hero currency field.
 *
 *   • Hero typography: 88px integer · 44px cents (Stripe-style demphasis)
 *   • Per-digit odometer roll on every value change (CSS-only, no rAF)
 *   • Aurora mesh background that subtly responds to focus
 *   • Mouse-tracked 3D tilt for a premium tactile feel
 *   • Quick-amount chips that animate the number rolling to a target
 *   • Magnitude bar (log scale, anchored at $10k) under the input
 *   • Caret hidden — type-and-replace UX (à la Cash App / Stripe)
 *   • Spelled-out value sub-line, animates in on each change
 *
 * The visible "amount" is rendered by the odometer; a transparent input
 * underneath captures keyboard, paste, and selection. The two share the
 * same formatted string so widths line up via tabular-nums.
 */
import { useEffect, useRef, useState } from "preact/hooks";

interface MoneyInputProps {
  initialCents?: number;
  onChange?: (cents: number | null) => void;
  name?: string;
}

const CHIP_PRESETS_CENTS = [50_00, 100_00, 500_00, 1_000_00, 5_000_00];
const MAGNITUDE_REF_CENTS = 100_000_000_00; // bar fills at $100M (log scale)

export default function MoneyInput(
  { initialCents = 0, onChange, name }: MoneyInputProps,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [display, setDisplay] = useState<string>(
    initialCents > 0 ? formatTyping((initialCents / 100).toString()) : "",
  );
  const [cents, setCents] = useState<number | null>(
    initialCents > 0 ? initialCents : null,
  );
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [stageWidth, setStageWidth] = useState(380);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Measure available stage width so the auto-shrink formula adapts to
  // wherever the card is mounted (story shell, chat panel, sidebar…).
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const update = () => {
      const w = card.clientWidth;
      // Card padding (28px each side) + $ glyph (~heroSize*0.55) + gaps
      // ≈ ~110px chrome. Subtract for amount stage budget.
      setStageWidth(Math.max(180, w - 110));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onChange?.(cents);
  }, [cents]);

  function setValue(c: number | null) {
    if (c === null || c === 0) {
      setDisplay("");
      setCents(null);
      return;
    }
    const asString = (c / 100).toFixed(2).replace(/\.00$/, "");
    setDisplay(formatTyping(asString));
    setCents(c);
  }

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const oldVal = el.value;
    const oldCaret = el.selectionStart ?? oldVal.length;
    const tokensBeforeCaret = oldVal
      .slice(0, oldCaret)
      .replace(/[^\d.]/g, "")
      .length;

    const formatted = formatTyping(oldVal);
    setDisplay(formatted);
    setCents(parseToCents(formatted));

    queueMicrotask(() => {
      const node = inputRef.current;
      if (!node) return;
      let pos = 0;
      let counted = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (counted >= tokensBeforeCaret) break;
        if (/[\d.]/.test(formatted[i])) counted++;
        pos = i + 1;
      }
      node.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.shiftKey ? 100_00 : 10_00;
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const next = Math.max(0, (cents ?? 0) + step * dir);
      setValue(next === 0 ? null : next);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;  // -0.5 .. 0.5
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--tilt-x", String(-y * 3));
    card.style.setProperty("--tilt-y", String(x * 3));
    card.style.setProperty("--shine-x", `${(x + 0.5) * 100}%`);
    card.style.setProperty("--shine-y", `${(y + 0.5) * 100}%`);
  }
  function handleMouseLeave() {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--tilt-x", "0");
    card.style.setProperty("--tilt-y", "0");
  }

  function clear() {
    setValue(null);
    inputRef.current?.focus();
  }

  const hasValue = (cents ?? 0) > 0;
  const words = hasValue ? centsToWords(cents!) : "";

  // Auto-shrink hero font so big numbers always fit. Counts the rendered
  // chars (digits + commas + ".00" tail + glyph buffer) and divides the
  // available stage width to get a per-char budget. Clamped 32..88px so
  // tiny numbers stay hero and 11-digit numbers ($99,999,999.99) still
  // clear with a safe gutter.
  const intDigitCount = ((display.split(".")[0]) || "0").replace(/[^\d]/g, "").length;
  const totalChars = intDigitCount
    + Math.max(0, Math.floor((intDigitCount - 1) / 3)) // commas
    + 3   // ".00"
    + 2;  // safety gutter
  const PX_PER_CH = 0.58;
  const heroSize = Math.max(
    32,
    Math.min(88, Math.floor(stageWidth / (totalChars * PX_PER_CH))),
  );

  // Magnitude bar fill: log-scaled so $50 reads, $5k still has headroom
  const magnitude = (cents ?? 0) === 0
    ? 0
    : Math.min(1, Math.log10(1 + (cents ?? 0)) / Math.log10(1 + MAGNITUDE_REF_CENTS));

  // Split display into integer / decimal halves so the cents render smaller
  const dotIdx = display.indexOf(".");
  const intStr = dotIdx === -1 ? display : display.slice(0, dotIdx);
  const decStr = dotIdx === -1 ? "" : display.slice(dotIdx); // includes "."

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div
        ref={cardRef}
        class={`mi ${focused ? "is-focused" : ""} ${hasValue ? "has-value" : ""} ${ready ? "is-ready" : ""}`}
        style={`--mi-hero:${heroSize}px`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={() => inputRef.current?.focus()}
      >
        <div class="mi__aurora" aria-hidden="true" />
        <div class="mi__shine" aria-hidden="true" />

        <div class="mi__eyebrow">Amount</div>

        <div class="mi__stage">
          <span class="mi__glyph" aria-hidden="true">$</span>
          <div class="mi__amount">
            <Odometer text={intStr || "0"} className="mi__int" empty={!hasValue} />
            <Odometer
              text={decStr || ".00"}
              className="mi__dec"
              empty={!hasValue}
            />
          </div>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellcheck={false}
            name={name}
            class="mi__input"
            value={display}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Amount in dollars"
          />
          <button
            type="button"
            class="mi__clear"
            aria-label="Clear amount"
            onClick={(e) => { e.stopPropagation(); clear(); }}
            tabIndex={hasValue ? 0 : -1}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <div class="mi__bar" aria-hidden="true">
          <div class="mi__bar-fill" style={`width:${(magnitude * 100).toFixed(2)}%`} />
        </div>

        <div class="mi__words" key={`w-${cents ?? 0}`}>
          {hasValue
            ? words
            : "Type or tap a preset · ↑ ↓ to nudge $10 · Shift = $100"}
        </div>

        <div class="mi__chips" role="group" aria-label="Quick amounts">
          {CHIP_PRESETS_CENTS.map((c) => (
            <button
              key={`chip-${c}`}
              type="button"
              class={`mi__chip ${cents === c ? "is-active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setValue(c); }}
            >
              ${shortMoney(c)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------------- */
/* Odometer — renders a string char-by-char; digits roll on change.      */
/* --------------------------------------------------------------------- */
function Odometer(
  { text, className, empty }: {
    text: string;
    className?: string;
    empty?: boolean;
  },
) {
  return (
    <span class={`odo ${className ?? ""} ${empty ? "is-empty" : ""}`}>
      {Array.from(text).map((ch, i) => (
        <OdoCell key={`${i}-${ch}`} ch={ch} />
      ))}
    </span>
  );
}

function OdoCell({ ch }: { ch: string }) {
  if (/\d/.test(ch)) {
    const n = parseInt(ch, 10);
    return (
      <span class="odo__cell">
        <span
          class="odo__col"
          style={`transform: translateY(${-n * 10}%)`}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <span key={`d-${i}`} class="odo__digit">{i}</span>
          ))}
        </span>
      </span>
    );
  }
  return <span class={`odo__static odo__static--${ch === "," ? "comma" : ch === "." ? "dot" : "other"}`}>{ch}</span>;
}

/* --------------------------------------------------------------------- */
/* Helpers                                                                */
/* --------------------------------------------------------------------- */

function parseToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const firstDot = cleaned.indexOf(".");
  let intPart = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  let decPart = firstDot === -1
    ? ""
    : cleaned.slice(firstDot + 1).replace(/\./g, "");
  if (intPart === "") intPart = "0";
  decPart = (decPart + "00").slice(0, 2);
  const cents = parseInt(intPart, 10) * 100 + parseInt(decPart, 10);
  return Number.isFinite(cents) ? cents : null;
}

function formatTyping(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  if (firstDot !== -1) {
    const dec = s.slice(firstDot + 1, firstDot + 3);
    s = s.slice(0, firstDot + 1) + dec;
  }
  const dot2 = s.indexOf(".");
  let intPart = dot2 === -1 ? s : s.slice(0, dot2);
  const decPart = dot2 === -1 ? "" : s.slice(dot2);
  if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
  const intFmt = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  return intFmt + decPart;
}

function shortMoney(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return (d / 1000) + "k";
  return String(d);
}

function centsToWords(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return "";
  if (cents === 0) return "zero dollars";
  const dollars = Math.floor(cents / 100);
  const c = cents % 100;
  const dStr = numToWords(dollars);
  const dLabel = dollars === 1 ? "dollar" : "dollars";
  if (c === 0) return `${dStr} ${dLabel}`;
  const cStr = numToWords(c);
  const cLabel = c === 1 ? "cent" : "cents";
  return `${dStr} ${dLabel} and ${cStr} ${cLabel}`;
}
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
function numToWords(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r === 0 ? `${ONES[h]} hundred` : `${ONES[h]} hundred ${numToWords(r)}`;
  }
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const r = n % 1000;
    return r === 0
      ? `${numToWords(k)} thousand`
      : `${numToWords(k)} thousand ${numToWords(r)}`;
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  return r === 0
    ? `${numToWords(m)} million`
    : `${numToWords(m)} million ${numToWords(r)}`;
}

/* --------------------------------------------------------------------- */
/* Styles                                                                 */
/* --------------------------------------------------------------------- */

const STYLES = `
.mi {
  --mi-teal: #0F3036;
  --mi-teal-2: #1A535C;
  --mi-green: #519843;
  --mi-green-2: #7BB568;
  --mi-pink: #FF6B6B;
  --mi-line: rgba(26,83,92,0.10);
  --mi-ink: #0F3036;
  --mi-ink-mute: #6E8689;
  --tilt-x: 0;
  --tilt-y: 0;
  --shine-x: 50%;
  --shine-y: 50%;

  position: relative;
  isolation: isolate;
  border-radius: 28px;
  padding: 26px 28px 22px;
  background: linear-gradient(180deg, #ffffff 0%, #fafaf5 100%);
  border: 1px solid var(--mi-line);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.9) inset,
    0 24px 60px -20px rgba(15,48,54,0.18),
    0 6px 18px -6px rgba(15,48,54,0.10);
  transform: perspective(1100px) rotateX(calc(var(--tilt-x) * 1deg)) rotateY(calc(var(--tilt-y) * 1deg));
  transition: transform 280ms cubic-bezier(.2,.7,.2,1), box-shadow 280ms;
  font-family: "Inter", system-ui, -apple-system, sans-serif;
  color: var(--mi-ink);
  cursor: text;
  overflow: hidden;
}
.mi.is-focused {
  box-shadow:
    0 1px 0 rgba(255,255,255,0.9) inset,
    0 0 0 3px rgba(81,152,67,0.18),
    0 30px 70px -20px rgba(15,48,54,0.22),
    0 8px 22px -6px rgba(15,48,54,0.12);
}

/* aurora mesh in background */
.mi__aurora {
  position: absolute;
  inset: -20%;
  z-index: 0;
  background:
    radial-gradient(40% 40% at 18% 22%, rgba(81,152,67,0.18), transparent 70%),
    radial-gradient(35% 35% at 82% 18%, rgba(255,107,107,0.10), transparent 70%),
    radial-gradient(45% 45% at 70% 90%, rgba(26,83,92,0.13), transparent 70%);
  filter: blur(28px) saturate(115%);
  opacity: 0.55;
  transition: opacity 320ms;
  pointer-events: none;
}
.mi.is-focused .mi__aurora { opacity: 0.95; }

/* mouse-tracked specular shine */
.mi__shine {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(220px 160px at var(--shine-x) var(--shine-y),
    rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 65%);
  mix-blend-mode: overlay;
  opacity: 0;
  transition: opacity 220ms;
}
.mi:hover .mi__shine,
.mi.is-focused .mi__shine { opacity: 0.9; }

.mi__eyebrow {
  position: relative;
  z-index: 1;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--mi-ink-mute);
  margin-bottom: 6px;
}

.mi__stage {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 4px 0 14px;
}
.mi__glyph {
  font-size: calc(var(--mi-hero, 88px) * 0.55);
  font-weight: 700;
  color: var(--mi-ink-mute);
  line-height: 1;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
  transition: color 260ms cubic-bezier(.2,.7,.2,1), transform 260ms, font-size 260ms;
  transform-origin: 50% 80%;
}
.mi.is-focused .mi__glyph,
.mi.has-value .mi__glyph {
  color: var(--mi-green);
  transform: translateY(-2px) scale(1.04);
  text-shadow: 0 8px 28px rgba(81,152,67,0.25);
}

.mi__amount {
  flex: 1;
  display: flex;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  letter-spacing: -0.035em;
  line-height: 1;
  min-height: 96px;
  white-space: nowrap;
  overflow: hidden;
  padding-bottom: 4px;
}
.mi__int {
  font-size: var(--mi-hero, 88px);
  font-weight: 800;
  color: var(--mi-teal);
  transition: color 260ms, opacity 220ms, font-size 260ms;
}
.mi__dec {
  font-size: calc(var(--mi-hero, 88px) * 0.5);
  font-weight: 700;
  color: rgba(15,48,54,0.32);
  margin-left: 2px;
  letter-spacing: -0.02em;
  transition: color 260ms, font-size 260ms;
}
.mi.has-value .mi__dec { color: rgba(26,83,92,0.55); }
.mi__int.is-empty,
.mi__dec.is-empty { color: rgba(15,48,54,0.18); text-shadow: none; }

/* odometer cells */
.odo {
  display: inline-flex;
  align-items: baseline;
}
.odo__cell {
  position: relative;
  display: inline-block;
  width: 1ch;
  height: 1em;
  overflow: hidden;
  vertical-align: baseline;
}
.odo__col {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.mi.is-ready .odo__col {
  transition: transform 460ms cubic-bezier(.22,.85,.25,1);
}
.odo__digit {
  display: block;
  height: 1em;
  line-height: 1;
  text-align: right;
}
.odo__static { display: inline-block; }
.odo__static--comma { width: 0.32ch; }
.odo__static--dot { width: 0.32ch; }

/* hidden but focusable input layered behind */
.mi__input {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: transparent;
  caret-color: transparent;
  font: inherit;
  font-size: 16px;
  padding: 0;
  margin: 0;
  cursor: text;
}
.mi__input::selection { background: transparent; }

.mi__clear {
  position: relative;
  z-index: 3;
  appearance: none;
  border: 0;
  background: rgba(15,48,54,0.06);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--mi-ink-mute);
  cursor: pointer;
  align-self: flex-start;
  margin-top: 4px;
  opacity: 0;
  transform: scale(0.7);
  transition:
    opacity 220ms cubic-bezier(.2,.7,.2,1),
    transform 220ms cubic-bezier(.2,.7,.2,1),
    background 160ms, color 160ms;
}
.mi.has-value .mi__clear { opacity: 1; transform: scale(1); }
.mi__clear:hover { background: rgba(255,107,107,0.14); color: var(--mi-pink); }
.mi__clear:focus-visible { outline: 2px solid rgba(81,152,67,0.45); outline-offset: 2px; }

/* magnitude bar */
.mi__bar {
  position: relative;
  z-index: 1;
  height: 4px;
  border-radius: 999px;
  background: rgba(15,48,54,0.07);
  overflow: hidden;
}
.mi__bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--mi-green) 0%, var(--mi-green-2) 60%, #ffd166 100%);
  box-shadow: 0 0 12px rgba(81,152,67,0.45);
  transition: width 540ms cubic-bezier(.22,.85,.25,1);
}

/* spelled-out value */
@keyframes mi-words-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.mi__words {
  position: relative;
  z-index: 1;
  margin-top: 14px;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .005em;
  color: var(--mi-ink-mute);
  line-height: 1.4;
  min-height: 18px;
  animation: mi-words-in 320ms cubic-bezier(.22,.85,.25,1);
}
.mi.has-value .mi__words {
  color: var(--mi-teal-2);
  font-weight: 600;
}
.mi__words::first-letter { text-transform: capitalize; }

/* quick chips */
.mi__chips {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.mi__chip {
  appearance: none;
  border: 1px solid rgba(15,48,54,0.12);
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(6px);
  color: var(--mi-teal-2);
  font: inherit;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.005em;
  padding: 7px 13px;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 160ms cubic-bezier(.2,.7,.2,1), background 160ms, border-color 160ms, color 160ms, box-shadow 160ms;
}
.mi__chip:hover {
  background: #fff;
  border-color: rgba(81,152,67,0.45);
  color: var(--mi-green);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(81,152,67,0.35);
}
.mi__chip:active { transform: translateY(0); }
.mi__chip.is-active {
  background: var(--mi-green);
  border-color: var(--mi-green);
  color: #fff;
  box-shadow: 0 6px 16px -6px rgba(81,152,67,0.6);
}
`;
