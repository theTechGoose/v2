/**
 * REQ-392 (demo-loop cycle 2, M7; cycle 1 M9) — the compact composer on the
 * guided flow's tap steps: Pick a price, the Job details picker, every wizard
 * question ("Who is this for?" and its customer form included) and the
 * Ready-to-send review.
 *
 * The big composer stays off those steps (REQ-041 NW-53b, the client's "if
 * they are tapping options there should be no input field"), so this is a
 * quiet secondary button — "Tell the assistant…" — that opens a one-line
 * field only when tapped. Enter (or the arrow) sends; what is sent goes to the
 * assistant WITH the step (AsstChat's sendStepText), and the assistant's
 * answer shows here on the two steps whose panel covers the thread (`note`).
 *
 * Which steps get it: `composerMode` in shared/quote-flow/step-composer.ts.
 *
 * Pick a price and the Job details picker own the panel and are bounded to
 * it (REQ-338: the picker fits at 1280×720), so there the closed box is not a
 * bar under the panel: its button (StepComposerOpen) sits in the step's own
 * Continue row, the box is controlled (`open`), and it shows under the panel
 * only once tapped.
 */
import { useRef, useState } from "preact/hooks";
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import type { ChatStepId } from "../../shared/quote-flow/step-composer.ts";

export interface StepComposerProps {
  step: ChatStepId;
  lang: Lang;
  /** A turn is in flight (this one or any other). */
  sending: boolean;
  /** The chat's error strip — a hidden composer must never swallow it. */
  error?: string;
  /** One-tap retry for a failed turn (the full composer's P-10 affordance). */
  onRetry?: () => void;
  /** The assistant's answer to a message typed here, shown on the step. */
  note?: string | null;
  /** Send the text; resolves true once the assistant answered (false keeps
   *  the text in the field for another try). */
  onSend: (text: string) => Promise<boolean>;
  /** Controlled: the step hosts the closed box's button in its own action row
   *  (StepComposerOpen). Closed, the box renders nothing but an error strip. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** The closed box's "Tell the assistant…" button. */
function OpenButton(
  props: { step: ChatStepId; lang: Lang; onOpen: () => void },
) {
  return (
    <button
      type="button"
      class="composer__step-open"
      data-cy="step-composer-open"
      data-step={props.step}
      onClick={props.onOpen}
    >
      <I d={ICN.msg} size={15} sw={2.2} />
      {tFor(props.lang, "asstChat.stepComposer.open")}
    </button>
  );
}

/** The closed box's button for a step that hosts it in its own Continue row
 *  (Pick a price, the Job details picker) — no height under the panel. */
export function StepComposerOpen(
  props: { step: ChatStepId; lang: Lang; onOpen: () => void },
) {
  return <OpenButton {...props} />;
}

export default function StepComposer(props: StepComposerProps) {
  const { step, lang, sending, error, onRetry, note, onSend } = props;
  const docked = props.open !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = docked ? props.open === true : ownOpen;
  const setOpen = (v: boolean) =>
    docked ? props.onOpenChange?.(v) : setOwnOpen(v);
  const [text, setText] = useState("");
  /** This box's own message is in flight (not just any turn — the price
   *  step's Continue also sets `sending`). */
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Set when the box opens (its own button or the step's); the field
   *  focuses itself as it mounts — during the render the tap scheduled, so a
   *  phone still raises the keyboard (a requestAnimationFrame focus would
   *  lose the gesture on iOS). */
  const focusOnMountRef = useRef(false);
  const wasOpenRef = useRef(open);
  if (open && !wasOpenRef.current) focusOnMountRef.current = true;
  wasOpenRef.current = open;
  // The two steps whose panel covers the thread show the turn's progress and
  // the answer here; on a wizard question / the review it lands in the thread.
  const ownsAnswer = step === "price" || step === "job_details";

  async function submit() {
    const said = text.trim();
    if (!said || sending) return;
    setText("");
    setAsking(true);
    const ok = await onSend(said).finally(() => setAsking(false));
    if (!ok) setText(said);
    inputRef.current?.focus({ preventScroll: true });
  }

  const errorStrip = error
    ? (
      <div class="composer__err">
        {error}
        {onRetry
          ? (
            <button
              type="button"
              class="composer__err-retry"
              style="margin-left:8px;appearance:none;border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:2px 10px;font-weight:700;cursor:pointer"
              onClick={onRetry}
            >
              {tFor(lang, "welcome.sample.retry")}
            </button>
          )
          : null}
      </div>
    )
    : null;

  // Docked and closed: the button is in the step's own row — nothing under
  // the panel but a failed turn's error.
  if (docked && !open) {
    return errorStrip
      ? <div class="composer composer--step">{errorStrip}</div>
      : null;
  }

  return (
    <div
      class={`composer composer--step${open ? " is-open" : ""}`}
      data-cy="step-composer"
      data-step={step}
    >
      {errorStrip}
      {ownsAnswer && (asking || note)
        ? (
          <div
            class="composer__step-note"
            data-cy="step-composer-note"
            aria-live="polite"
          >
            <img src="/logo-monster.png" alt="" />
            <span>
              {asking ? tFor(lang, "asstChat.stepComposer.thinking") : note}
            </span>
          </div>
        )
        : null}
      {open
        ? (
          <form
            class="composer__step-row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={(el) => {
                inputRef.current = el;
                if (el && focusOnMountRef.current) {
                  focusOnMountRef.current = false;
                  el.focus({ preventScroll: true });
                }
              }}
              type="text"
              class="composer__step-input"
              data-cy="step-composer-input"
              enterkeyhint="send"
              autoComplete="off"
              placeholder={tFor(
                lang,
                `asstChat.stepComposer.placeholder.${step}`,
              )}
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !text.trim()) setOpen(false);
              }}
            />
            <button
              type="submit"
              class="composer__send"
              data-cy="step-composer-send"
              aria-label={tFor(lang, "common.send")}
              title={tFor(lang, "common.send")}
              disabled={sending || !text.trim()}
            >
              <I d={ICN.arrow} size={16} sw={2.4} />
            </button>
            <button
              type="button"
              class="composer__step-close"
              aria-label={tFor(lang, "asstChat.stepComposer.close")}
              title={tFor(lang, "asstChat.stepComposer.close")}
              onClick={() => setOpen(false)}
            >
              <I d={ICN.x} size={14} sw={2.4} />
            </button>
          </form>
        )
        : <OpenButton step={step} lang={lang} onOpen={() => setOpen(true)} />}
    </div>
  );
}
