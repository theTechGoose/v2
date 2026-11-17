/**
 * REQ-707 (demo-loop cycle 5, m61): the one inline "are you sure?" row the
 * invoice card uses for Delete, Send a nudge and Didn't get it. An outlined
 * Yes (coral for destructive, teal otherwise), a ghost No, and — when the row
 * sits at card level rather than inside .qcard__back-body — the body's 22px
 * side inset, so the question never runs to the card edge. Styles live in
 * quotes.css (`.confirm-row*`).
 */
import type { ComponentChildren, JSX } from "preact";

type Handler = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => unknown;

export interface ConfirmRowProps {
  /** data-cy of the row; Yes/No default to `${cy}-yes` / `${cy}-no`. */
  cy: string;
  yesCy?: string;
  noCy?: string;
  ask: ComponentChildren;
  yesLabel: ComponentChildren;
  noLabel: ComponentChildren;
  onYes: Handler;
  onNo: Handler;
  busy?: boolean;
  /** danger = coral outline (rejects, deletes); primary = teal outline. */
  tone?: "danger" | "primary";
  /** Card-level row: pad the sides like .qcard__back-body. */
  inset?: boolean;
}

export default function ConfirmRow(
  {
    cy,
    yesCy,
    noCy,
    ask,
    yesLabel,
    noLabel,
    onYes,
    onNo,
    busy = false,
    tone = "danger",
    inset = false,
  }: ConfirmRowProps,
) {
  return (
    <div
      data-cy={cy}
      role="alert"
      class={`confirm-row${inset ? " confirm-row--inset" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span class="confirm-row__ask">{ask}</span>
      <button
        type="button"
        data-cy={yesCy ?? `${cy}-yes`}
        class={`confirm-row__yes confirm-row__yes--${tone}`}
        onClick={onYes}
        disabled={busy}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        data-cy={noCy ?? `${cy}-no`}
        class="confirm-row__no"
        onClick={onNo}
      >
        {noLabel}
      </button>
    </div>
  );
}
