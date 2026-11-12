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
 * REQ-635 (demo m37, cycle 5) — `offZ`: the marker's layer while off (the customer's overlay puts
 * it under the app's modal dims); the stage passes none and keeps it on top.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Pt, Rect } from "../../../shared/demo-mode/motion.ts";
import { useGlide } from "../../lib/demo-mode/use-glide.ts";
import DemoPointer, {
  type Bounds,
  type Wave,
  WAVE_MS,
} from "./DemoPointer.tsx";

export interface PointerCmd {
  seq: number;
  kind: "move" | "click" | "leave";
  at?: Pt;
  /** REQ-305 — `at` is on the edge of the box: the element pointed at is out of view */
  outside?: boolean;
  /** REQ-451 — the pointer is off the shared screen: the small edge marker, no tag */
  off?: boolean;
  /** REQ-437 — the box of the element `at` is anchored to: the name tag sits outside it */
  rect?: Rect | null;
}

export default function PeerPointer(
  { name, color, z, offZ, cmd, bounds }: {
    name: string;
    color: string;
    z: number;
    /** REQ-635 — the layer while off the shared screen */
    offZ?: number;
    cmd: PointerCmd | null;
    bounds?: Bounds;
  },
) {
  const glide = useGlide();
  const [off, setOff] = useState(false);
  const [waves, setWaves] = useState<Wave[]>([]);
  const waveId = useRef(0);
  useEffect(() => {
    if (!cmd) return;
    switch (cmd.kind) {
      case "move":
        if (cmd.at) {
          glide.glideTo(cmd.at, cmd.outside, cmd.rect);
          setOff(cmd.off === true);
        }
        break;
      case "click": {
        if (!cmd.at) break;
        const at = cmd.at;
        glide.glideTo(at, cmd.outside, cmd.rect);
        setOff(cmd.off === true);
        const id = ++waveId.current;
        setWaves((w) => [...w, { id, ...at }]);
        setTimeout(
          () => setWaves((w) => w.filter((x) => x.id !== id)),
          WAVE_MS,
        );
        break;
      }
      case "leave":
        glide.hide();
        setOff(false);
        break;
    }
  }, [cmd?.seq]);
  return (
    <DemoPointer
      pointer={glide.pointer}
      outside={glide.outside}
      off={off}
      rect={glide.rect}
      waves={waves}
      name={name}
      color={color}
      z={z}
      offZ={offZ}
      attach={glide.attach}
      bounds={bounds}
    />
  );
}
