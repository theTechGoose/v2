/**
 * REQ-235 — End, which asks first, in place (no modal): the first click turns End into "End for
 * everyone?" with "Yes, end it" and "Keep going"; Keep going, Escape, or a click outside the
 * question puts End back (REQ-300: never a clock — the 4 s self-cancel beat the answer); Yes
 * counts after END_ARM_MS (a double click on End never ends a demo) and calls `onEnd` at once, so
 * the pill says so before the server answers (REQ-179). Drawn in the customer's pill and on every
 * stage.
 *
 * REQ-379 (M28) — the customer's pill lets a click on its empty area through to the page; End, its
 * question and both answers take their own clicks (`pointer-events:auto`), so a click on the
 * question's words is never "outside" it.
 *
 * REQ-544 (demo-loop cycle 4, m49) — speaks the caller's language: the caller passes its `t`
 * (the overlay's is the demo chrome's, which keeps the viewer's language on /worker; the stage's
 * is the app's). Never the global t — on /worker that follows the signed-in worker.
 *
 * REQ-649 (demo-loop cycle 5, m64) — the question is the caller's: the stage keeps "End for
 * everyone?" (`demoMode.endAsk`, a presenter among staff); the customer's pill passes
 * `askKey="demoMode.endAskViewer"` with the guide's name ("End the demo with {name}?").
 *
 * REQ-855 (demo-loop cycle dm3, m5) — `outline`: a secondary action in its host (the presenter's
 * pill off the stage, beside its solid Back to the demo) — outlined, not a second solid button.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { Vars } from "../../lib/i18n.ts";
import {
  type EndAsk,
  endConfirm,
  yesArmsAtOnce,
} from "../../../shared/demo-mode/ended.ts";

const BTN =
  "padding:5px 12px;border-radius:8px;border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:700;pointer-events:auto";
/** End and Yes. REQ-865 (cycle dm4, p1) — exported: the stage's ghost draws them with these */
export const END_BTN = BTN;
/** Keep going's style, as drawn below. REQ-865 — exported for the stage's ghost (a unit test
 *  holds the two equal) */
export const END_NO =
  "padding:5px 6px;border:0;background:transparent;color:#fff;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;font-weight:600;pointer-events:auto";
/** REQ-855 — End as an outlined secondary on a dark pill */
const OUTLINE =
  "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)";

/** The caller's string lookup (REQ-544). */
export type DemoT = (key: string, vars?: Vars) => string;

/** REQ-649 — which question End asks (default: the stage's "End for everyone?"). */
export type EndAskWords = { askKey?: string; askVars?: Vars };

/** REQ-544 — End, its question and both answers, in the caller's language. */
export function endDemoWords(
  t: DemoT,
  { askKey = "demoMode.endAsk", askVars }: EndAskWords = {},
) {
  return {
    end: t("demoMode.end"),
    ask: t(askKey, askVars),
    yes: t("demoMode.endYes"),
    no: t("demoMode.endNo"),
  };
}

export default function EndDemo(
  {
    onEnd,
    disabled = false,
    ownRow = false,
    onAsking,
    t,
    askAtOnce = false,
    askKey,
    askVars,
    outline = false,
    guard,
    pressedAt,
  }: {
    onEnd: () => void;
    /** REQ-235 AMENDMENT (demo-loop run 18, m1) — where the press that asked landed when it was
     *  not End's own click (the folded tab's ×, `askAtOnce`): Yes arms at once when that press
     *  is not on it. Null: unknown — the clock as before */
    pressedAt?: () => { x: number; y: number } | null;
    /** REQ-890 AMENDMENT 4 (demo-loop run 15, m2) — asked before End asks: true, the host took
     *  this click as its own (the tab's, where a resting pointer opened the peek) */
    guard?: (e: MouseEvent) => boolean;
    disabled?: boolean;
    /** REQ-548 — the question takes a whole row of a wrapping host (the phone's compact pill) */
    ownRow?: boolean;
    /** REQ-548 — the host hears when the question goes up and comes down */
    onAsking?: (asking: boolean) => void;
    /** REQ-544 — the host's demo-chrome t (the viewer's language, never the page's) */
    t: DemoT;
    /** REQ-637 (demo-loop cycle 5, m5) — shown already asking: the folded mini-pill's × was End's
     *  first click (Yes still waits END_ARM_MS, so no tap ends a demo on its own) */
    askAtOnce?: boolean;
    /** REQ-855 — drawn outlined (a secondary beside its host's primary) */
    outline?: boolean;
  } & EndAskWords,
) {
  const words = endDemoWords(t, { askKey, askVars });
  const [s, setS] = useState<EndAsk>({ asking: false, armed: false });
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onAskingRef = useRef(onAsking);
  onAskingRef.current = onAsking;
  const ask = useMemo(
    () =>
      endConfirm({
        // REQ-548 — the host hears it in the same render as the question (no frame of a squeeze)
        onChange: (next) => {
          setS(next);
          onAskingRef.current?.(next.asking);
        },
        onEnd: () => onEndRef.current(),
      }),
    [],
  );
  // REQ-637 — mounted out of the mini-pill's ×: the question is up from the first frame
  useEffect(() => {
    if (askAtOnce) ask.ask();
  }, []);
  // REQ-235 AMENDMENT (demo-loop run 18, m1) — the wait before Yes counts is for a double click's
  // second click, which lands where the first did: a Yes the press is not on arms at once
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const yesRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!s.asking || s.armed) return;
    const press = pressRef.current ?? pressedAt?.() ?? null;
    const yes = yesRef.current?.getBoundingClientRect() ?? null;
    if (yesArmsAtOnce(press, yes)) ask.arm();
  }, [s.asking, s.armed]);
  useEffect(() => () => {
    ask.dispose();
    // REQ-548 — gone (the demo ended): the host is no longer asked anything
    onAskingRef.current?.(false);
  }, []);
  // the demo ended some other way while asking: nothing left to ask
  useEffect(() => {
    if (disabled) ask.cancel();
  }, [disabled]);
  // the keyboard lands on the safe answer
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const askRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (s.asking) keepRef.current?.focus();
  }, [s.asking]);
  // REQ-300 — a click anywhere outside the question is Keep going (the pill's own box is frozen
  // while asking, so a click aimed at Yes lands on Yes; a click elsewhere means "not that")
  useEffect(() => {
    if (!s.asking) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && askRef.current?.contains(target)) return;
      ask.cancel();
    };
    document.addEventListener("pointerdown", onDown, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", onDown, { capture: true });
  }, [s.asking]);

  if (!s.asking) {
    return (
      <button
        type="button"
        data-cy="demo-end"
        disabled={disabled}
        onClick={(e) => {
          if (guard?.(e)) return;
          // REQ-235 AMENDMENT — a pointer's press (the keyboard's has no place: the clock)
          pressRef.current = e.detail > 0
            ? { x: e.clientX, y: e.clientY }
            : null;
          ask.ask();
        }}
        style={`${BTN};${outline ? OUTLINE : "background:#fff;color:#7a2e2e"}${
          disabled ? ";opacity:.55;cursor:default" : ""
        }`}
      >
        {words.end}
      </button>
    );
  }
  return (
    <span
      ref={askRef}
      data-cy="demo-end-ask"
      role="group"
      onKeyDown={(e) => {
        if (e.key === "Escape") ask.cancel();
      }}
      style={"display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;pointer-events:auto" +
        (ownRow ? ";flex-basis:100%;white-space:normal;min-width:0" : "")}
    >
      <span style="font-weight:700">{words.ask}</span>
      <button
        ref={yesRef}
        type="button"
        data-cy="demo-end-confirm"
        disabled={!s.armed}
        onClick={ask.confirm}
        style={`${BTN};background:#c62828;color:#fff${
          s.armed ? "" : ";opacity:.55;cursor:default"
        }`}
      >
        {words.yes}
      </button>
      <button
        ref={keepRef}
        type="button"
        data-cy="demo-end-cancel"
        onClick={ask.cancel}
        style="padding:5px 6px;border:0;background:transparent;color:#fff;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;font-weight:600;pointer-events:auto"
      >
        {words.no}
      </button>
    </span>
  );
}
