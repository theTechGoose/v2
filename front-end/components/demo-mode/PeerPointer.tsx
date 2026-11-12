/**
 * REQ-214 — one remote pointer with its own glide and waves: a presenter's on the customer's
 * screen, a colleague's on a stage. Driven by `cmd`, the latest thing that side did (a move or a
 * click at a point of THIS screen, or leaving); `seq` makes every command new.
 *
 * REQ-242 — `bounds`: the box the name tag stays inside (the stage's frame, the customer's window).
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
  /** REQ-437 — the box of the element `at` is anchored to: the name tag sits outside it */
  rect?: Rect | null;
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
  const [waves, setWaves] = useState<Wave[]>([]);
  const waveId = useRef(0);
  useEffect(() => {
    if (!cmd) return;
    switch (cmd.kind) {
      case "move":
        if (cmd.at) glide.glideTo(cmd.at, cmd.outside, cmd.rect);
        break;
      case "click": {
        if (!cmd.at) break;
        const at = cmd.at;
        glide.glideTo(at, cmd.outside, cmd.rect);
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
        break;
    }
  }, [cmd?.seq]);
  return (
    <DemoPointer
      pointer={glide.pointer}
      outside={glide.outside}
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
