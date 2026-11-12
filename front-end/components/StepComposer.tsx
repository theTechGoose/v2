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
 * assistant WITH the step (AsstChat's sendStepText). On the two steps whose
 * panel covers the thread, the exchange shows here (REQ-442, demo-loop cycle
 * 3, M22 + m49): the contractor's own line and the assistant's answer (`log`),
 * and while it runs their words under "Rewriting with your change…"
 * (`pending`).
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
import type {
  ChatStepId,
  StepExchange,
} from "../../shared/quote-flow/step-composer.ts";

export interface StepComposerProps {
  step: ChatStepId;
  lang: Lang;
  /** A turn is in flight (this one or any other). */
  sending: boolean;
  /** The chat's error strip — a hidden composer must never swallow it. */
  error?: string;
  /** One-tap retry for a failed turn (the full composer's P-10 affordance). */
  onRetry?: () => void;
  /** REQ-442: this step's exchanges — what was typed here and the
   *  assistant's answer — shown on the step (its panel covers the thread). */
  log?: readonly StepExchange[] | null;
  /** REQ-442: the message typed here that is in flight, shown with
   *  "Rewriting with your change…" until the answer lands. */
  pending?: string | null;
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
  const { step, lang, sending, error, onRetry, log, pending, onSend } = props;
  const docked = props.open !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = docked ? props.open === true : ownOpen;
  const setOpen = (v: boolean) =>
    docked ? props.onOpenChange?.(v) : setOwnOpen(v);
  const [text, setText] = useState("");
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
    const ok = await onSend(said);
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

  // REQ-442 (M22 + m49): the step's own transcript — the contractor's line,
  // the assistant's answer, and the message in flight with its words.
  const exchanges = ownsAnswer ? log ?? [] : [];
  const inFlight = ownsAnswer && pending ? pending : null;
  const transcript = exchanges.length > 0 || inFlight
    ? (
      <div class="composer__step-log" aria-live="polite">
        {exchanges.map((x, i) => (
          <div key={i} class="composer__step-exchange">
            <div class="composer__step-said" data-cy="step-composer-said">
              <strong>{tFor(lang, "asstChat.stepComposer.you")}:</strong>{" "}
              {x.said}
            </div>
            {x.answer
              ? (
                <div class="composer__step-note" data-cy="step-composer-note">
                  <img src="/logo-monster.png" alt="" />
                  <span>{x.answer}</span>
                </div>
              )
              : null}
          </div>
        ))}
        {inFlight
          ? (
            <div
              class="composer__step-exchange"
              data-cy="step-composer-pending"
            >
              <div class="composer__step-said">
                <strong>{tFor(lang, "asstChat.stepComposer.you")}:</strong>{" "}
                {inFlight}
              </div>
              <div class="composer__step-note">
                <span class="spinner" aria-hidden="true" />
                <span>
                  {tFor(
                    lang,
                    step === "job_details"
                      ? "asstChat.stepComposer.rewriting"
                      : "asstChat.stepComposer.thinking",
                  )}
                </span>
              </div>
            </div>
          )
          : null}
      </div>
    )
    : null;

  // Docked and closed: the button is in the step's own row — nothing under
  // the panel but a failed turn's error and the step's transcript.
  if (docked && !open) {
    return errorStrip || transcript
      ? (
        <div class="composer composer--step" data-step={step}>
          {errorStrip}
          {transcript}
        </div>
      )
      : null;
  }

  return (
    <div
      class={`composer composer--step${open ? " is-open" : ""}`}
      data-cy="step-composer"
      data-step={step}
    >
      {errorStrip}
      {transcript}
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
