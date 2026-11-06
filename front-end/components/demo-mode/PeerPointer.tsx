/**
 * REQ-214 — one remote pointer with its own glide and waves: a presenter's on the customer's
 * screen, a colleague's on a stage. Driven by `cmd`, the latest thing that side did (a move or a
 * click at a point of THIS screen, or leaving); `seq` makes every command new.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Pt } from "../../../shared/demo-mode/motion.ts";
import { useGlide } from "../../lib/demo-mode/use-glide.ts";
import DemoPointer, { type Wave, WAVE_MS } from "./DemoPointer.tsx";

export interface PointerCmd {
  seq: number;
  kind: "move" | "click" | "leave";
  at?: Pt;
}

export default function PeerPointer(
  { name, color, z, cmd }: {
    name: string;
    color: string;
    z: number;
    cmd: PointerCmd | null;
  },
) {
  const glide = useGlide();
  const [waves, setWaves] = useState<Wave[]>([]);
  const waveId = useRef(0);
  useEffect(() => {
    if (!cmd) return;
    switch (cmd.kind) {
      case "move":
        if (cmd.at) glide.glideTo(cmd.at);
        break;
      case "click": {
        if (!cmd.at) break;
        const at = cmd.at;
        glide.glideTo(at);
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
      waves={waves}
      name={name}
      color={color}
      z={z}
      attach={glide.attach}
    />
  );
}
