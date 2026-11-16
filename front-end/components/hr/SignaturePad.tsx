/**
 * REQ-885e — the phone's signature pad: draw with a finger (pointer events, hi-DPI backing
 * store), Clear, and the PNG data URL of what was drawn. `onChange(dataUrl | null)` fires on
 * every stroke end and on clear.
 */
import { useEffect, useRef } from "preact/hooks";

interface Props {
  onChange: (png: string | null) => void;
  height?: number;
  /** a bumped key resets the pad (the next document) */
  resetKey?: string | number;
  clearLabel: string;
  hint: string;
}

export default function SignaturePad(
  { onChange, height = 150, resetKey, clearLabel, hint }: Props,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round((rect.width || 288) * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16201a";
    inkRef.current = false;
    let drawing = false;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      const [x, y] = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      c.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      inkRef.current = true;
      e.preventDefault();
    };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      if (inkRef.current) onChange(c.toDataURL("image/png"));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("pointerleave", up);
    };
  }, [resetKey, height]);

  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    inkRef.current = false;
    onChange(null);
  }

  return (
    <div class="sigpad">
      <canvas
        ref={canvasRef}
        data-cy="sign-pad"
        style={`display:block;width:100%;height:${height}px;touch-action:none;border-radius:12px`}
      />
      <div class="sigpad__foot">
        <span class="sigpad__hint" data-cy="sign-pad-hint">{hint}</span>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          data-cy="sign-clear"
          onClick={clear}
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}
