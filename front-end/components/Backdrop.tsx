import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  createBackdropGuard,
  documentEscapeLayers,
} from "../lib/backdrop-dismiss.ts";

/**
 * REQ-354 (demo issue M39): the one way a full-screen overlay closes on a
 * click outside its dialog. Mount it only while the dialog is open — its
 * mount time is the open time the guard measures from. A double-click on
 * the opener, a click within ~300 ms of opening, or a press that started
 * inside the dialog never closes it (lib/backdrop-dismiss.ts).
 *
 * REQ-732 (demo-loop cycle 5, m26): Escape closes it too — the topmost open
 * dialog only, and not when a list inside it already took the Escape. Escape
 * runs `onEscape` when given, else `onClose` (so its busy guards hold).
 */
type Props =
  & Omit<JSX.HTMLAttributes<HTMLDivElement>, "onClick" | "onPointerDown">
  & {
    /** called on a deliberate backdrop click; guard busy states inside it */
    onClose: () => void;
    /** REQ-732: what Escape does, when it differs from a backdrop click (default: onClose) */
    onEscape?: () => void;
    children?: ComponentChildren;
  };

export default function Backdrop(
  { onClose, onEscape, children, ...rest }: Props,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(
    () =>
      documentEscapeLayers()?.push(() =>
        (escapeRef.current ?? closeRef.current)()
      ),
    [],
  );
  const guard = useRef<ReturnType<typeof createBackdropGuard> | null>(null);
  if (!guard.current) {
    guard.current = createBackdropGuard(() => closeRef.current());
  }
  const g = guard.current;
  return (
    <div
      {...rest}
      onPointerDown={(e) => g.onPointerDown(e)}
      onClick={(e) => g.onClick(e)}
    >
      {children}
    </div>
  );
}
