/**
 * REQ-214 — one remote pointer with its own glide and waves: a presenter's on the customer's
 * screen, a colleague's on a stage. Driven by `cmd`, the latest thing that side did (a move or a
 * click at a point of THIS screen, or leaving); `seq` makes every command new.
 *
 * REQ-242 — `bounds`: the box the name tag stays inside (the stage's frame, the customer's window).
 *
 * REQ-451 (demo M14) — `off` on a command: that side's pointer is off the shared screen (its
 * mouse beside the frame on its stage) — drawn as DemoPointer's small edge marker, no name tag.
 *
 * REQ-645 (demo-loop cycle 5) — a move may carry a `cue` (the element is out of view: the marker
 * where it can be seen, with the way to it) and `faded` (the element moved away since he
 * pointed); a `pending` command shows "{name} is pointing…" (no arrow) for PENDING_MS at most —
 * the next move, click or leave replaces it.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Pt, Rect } from "../../../shared/demo-mode/motion.ts";
import { PENDING_MS } from "../../../shared/demo-mode/presenter-anchor.ts";
import { useGlide } from "../../lib/demo-mode/use-glide.ts";
import DemoPointer, {
  type Bounds,
  type Wave,
  WAVE_MS,
} from "./DemoPointer.tsx";

export interface PointerCmd {
  seq: number;
  kind: "move" | "click" | "leave" | "pending";
  at?: Pt;
  /** REQ-305 — `at` is on the edge of the box: the element pointed at is out of view */
  outside?: boolean;
  /** REQ-451 — the pointer is off the shared screen: the small edge marker, no tag */
  off?: boolean;
  /** REQ-437 — the box of the element `at` is anchored to: the name tag sits outside it */
  rect?: Rect | null;
  /** REQ-645 — the element is out of view: the marker against the edge of `box` (where it can be
   *  seen), with `text` (the way to it; empty: the marker alone) */
  cue?: { box: Rect; text: string } | null;
  /** REQ-645 — the element moved more than DRIFT_FADE_PX since he pointed: faded */
  faded?: boolean;
  /** REQ-645 — a `pending` command's words ("{name} is pointing…") */
  text?: string;
}

export default function PeerPointer(
  { name, color, z, cmd, bounds }: {
    name: string;
    color: string;
    z: number;
    cmd: PointerCmd | null;
    bounds?: Bounds;
  },
) {
  const glide = useGlide();
  const [off, setOff] = useState(false);
  /** REQ-645 — out of view (the marker and its words), moved away (faded), being found again */
  const [cue, setCue] = useState<PointerCmd["cue"]>(null);
  const [faded, setFaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waves, setWaves] = useState<Wave[]>([]);
  const waveId = useRef(0);
  useEffect(() => {
    if (!cmd) return;
    // REQ-645 — any command ends a "pointing…" (a new one starts its own)
    if (pendRef.current) clearTimeout(pendRef.current);
    pendRef.current = null;
    switch (cmd.kind) {
      case "move":
        if (cmd.at) {
          glide.glideTo(cmd.at, cmd.outside, cmd.rect);
          setOff(cmd.off === true);
          setCue(cmd.cue ?? null);
          setFaded(cmd.faded === true);
          setPending(null);
        }
        break;
      case "click": {
        if (!cmd.at) break;
        const at = cmd.at;
        glide.glideTo(at, cmd.outside, cmd.rect);
        setOff(cmd.off === true);
        setCue(cmd.cue ?? null);
        setFaded(cmd.faded === true);
        setPending(null);
        const id = ++waveId.current;
        setWaves((w) => [...w, { id, ...at }]);
        setTimeout(
          () => setWaves((w) => w.filter((x) => x.id !== id)),
          WAVE_MS,
        );
        break;
      }
      case "pending":
        // REQ-645 — "{name} is pointing…" near where his arrow will be, PENDING_MS at most
        if (cmd.at) {
          glide.glideTo(cmd.at, false, null);
          setOff(false);
          setCue(null);
          setFaded(false);
          setPending(cmd.text ?? "");
          pendRef.current = setTimeout(() => {
            pendRef.current = null;
            glide.hide();
            setPending(null);
          }, PENDING_MS);
        }
        break;
      case "leave":
        glide.hide();
        setOff(false);
        setCue(null);
        setFaded(false);
        setPending(null);
        break;
    }
  }, [cmd?.seq]);
  useEffect(() => () => {
    if (pendRef.current) clearTimeout(pendRef.current);
  }, []);
  return (
    <DemoPointer
      pointer={glide.pointer}
      outside={glide.outside}
      off={off}
      cue={cue}
      faded={faded}
      pending={pending}
      rect={glide.rect}
      waves={waves}
      name={name}
      color={color}
      z={z}
      attach={glide.attach}
      bounds={bounds}
    />
  );
}
