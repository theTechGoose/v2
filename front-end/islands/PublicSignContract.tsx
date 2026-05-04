import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  contractId: string;
}

interface Stroke {
  points: { x: number; y: number; t: number }[];
}

const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";
const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";

/**
 * Customer-facing signature pad. Two-input flow:
 *   1. **Draw** your signature on a canvas (pointer / touch / pen).
 *   2. **Type** your full legal name underneath.
 * Both are submitted to /api/contracts/:id/sign as `signature` (PNG data
 * URL) + `name`. The typed name is the legal-record fallback; the canvas
 * captures the visual mark.
 *
 * The pad supports:
 *   - Hi-DPI strokes (we scale the canvas backing buffer to devicePixelRatio).
 *   - Variable stroke width (faster movement = thinner line) for an
 *     ink-pen feel rather than a flat Sharpie.
 *   - Undo last stroke (popping the strokes array and replaying).
 *   - Clear pad (reset to blank).
 *   - Resize-aware redraw (so the signature doesn't disappear if the
 *     viewport changes mid-flow).
 */
export default function PublicSignContract({ contractId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [err, setErr] = useState<string | undefined>();

  // ---- canvas plumbing ------------------------------------------------------

  function getCanvas() {
    return canvasRef.current!;
  }

  function setupCanvas() {
    const canvas = getCanvas();
    if (!canvas) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    redraw();
  }

  function redraw() {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = TEAL;
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }
    if (drawingRef.current) drawStroke(ctx, drawingRef.current);
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    const pts = stroke.points;
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dt = Math.max(1, b.t - a.t);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const speed = dist / dt; // px / ms
      // Faster = thinner. 0.05px/ms → ~3.2px; 1.5px/ms → ~1.0px.
      const width = Math.max(0.9, Math.min(3.2, 3.4 - speed * 1.6));
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function pointerXY(e: PointerEvent | MouseEvent | TouchEvent): { x: number; y: number } {
    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const native = "touches" in e
      ? (e.touches[0] ?? (e as TouchEvent).changedTouches[0])
      : (e as PointerEvent | MouseEvent);
    const x = (native as { clientX: number }).clientX - rect.left;
    const y = (native as { clientY: number }).clientY - rect.top;
    return { x, y };
  }

  // ---- event handlers -------------------------------------------------------

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    const canvas = getCanvas();
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pointerXY(e);
    drawingRef.current = { points: [{ x, y, t: performance.now() }] };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const { x, y } = pointerXY(e);
    drawingRef.current.points.push({ x, y, t: performance.now() });
    redraw();
  }

  function onPointerUp(e: PointerEvent) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = getCanvas();
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (drawingRef.current.points.length > 1) {
      strokesRef.current.push(drawingRef.current);
      setHasInk(true);
    }
    drawingRef.current = null;
    redraw();
  }

  function clearPad() {
    strokesRef.current = [];
    drawingRef.current = null;
    setHasInk(false);
    redraw();
  }

  function undoStroke() {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    setHasInk(strokesRef.current.length > 0);
    redraw();
  }

  // ---- lifecycle ------------------------------------------------------------

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    globalThis.addEventListener("resize", onResize);
    return () => globalThis.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- submit ---------------------------------------------------------------

  /** Render a compact PNG of just the inked region. The full canvas at
   *  hi-DPI is ~150KB+ which trips the backend's 64KB row-size limit;
   *  this shrinks to ~3-10KB by (a) cropping to the strokes' bounding box
   *  and (b) capping output width at 480px. */
  function exportSignaturePng(): string {
    const all = strokesRef.current;
    if (all.length === 0) return "";
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of all) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const pad = 10;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = maxX + pad;
    maxY = maxY + pad;
    const srcW = Math.max(1, maxX - minX);
    const srcH = Math.max(1, maxY - minY);
    const maxW = 480;
    const scale = srcW > maxW ? maxW / srcW : 1;
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);
    const off = document.createElement("canvas");
    off.width = outW;
    off.height = outH;
    const ctx = off.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(-minX * scale, -minY * scale);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = TEAL;
    for (const stroke of all) drawStroke(ctx, stroke);
    return off.toDataURL("image/png");
  }

  async function onSign(e: Event) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !hasInk) return;
    setSubmitting(true);
    setErr(undefined);
    try {
      const dataUrl = exportSignaturePng();
      const r = await fetch(`/api/contracts/${contractId}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, signature: dataUrl }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(text.slice(0, 200) || `${r.status}`);
      }
      setStatus("ok");
      // Reload after a brief moment so the SSR-rendered "signed" state
      // takes over: the customer-signature card on the right fills in
      // with the typed name + date, matching the contractor card on the
      // left.
      setTimeout(() => {
        try { globalThis.location.reload(); } catch { /* SSR-safe */ }
      }, 900);
    } catch (e) {
      setStatus("error");
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- render ---------------------------------------------------------------

  if (status === "ok") {
    return (
      <div style={`margin-top:24px;background:linear-gradient(135deg,rgba(81,152,67,0.10) 0%,rgba(81,152,67,0.04) 100%);border:1px solid rgba(72,158,95,0.35);border-radius:18px;padding:24px;text-align:center`}>
        <div style={`width:48px;height:48px;border-radius:50%;background:${GREEN};color:#fff;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div style={`font-weight:800;color:${GREEN};font-size:18px`}>Signed and binding</div>
        <div style={`margin-top:6px;color:${MUTED};font-size:13px;max-width:320px;margin-left:auto;margin-right:auto`}>
          Please allow up to 2 minutes before checking your email inbox. Don't forget to check spam.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSign} style="margin-top:24px;text-align:left">
      {/* Sign header strip */}
      <div style={`display:flex;justify-content:space-between;align-items:center;margin-bottom:8px`}>
        <div style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PINK_DARK}`}>Your signature</div>
        <div style={`display:flex;gap:8px`}>
          <button
            type="button"
            onClick={undoStroke}
            disabled={!hasInk}
            aria-label="Undo last stroke"
            style={`background:transparent;border:1px solid ${LINE};border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:${hasInk ? INK : MUTED};cursor:${hasInk ? "pointer" : "not-allowed"};display:inline-flex;align-items:center;gap:6px`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
            Undo
          </button>
          <button
            type="button"
            onClick={clearPad}
            disabled={!hasInk}
            aria-label="Clear signature"
            style={`background:transparent;border:1px solid ${LINE};border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:${hasInk ? INK : MUTED};cursor:${hasInk ? "pointer" : "not-allowed"};display:inline-flex;align-items:center;gap:6px`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            Clear
          </button>
        </div>
      </div>

      {/* Pad */}
      <div
        style={`position:relative;background:#fff;border:2px dashed ${PINK};border-radius:18px;overflow:hidden;box-shadow:0 8px 24px -10px rgba(255,107,107,0.30)`}
      >
        {/* faint grid + baseline so it feels like a signing card */}
        <div
          aria-hidden="true"
          style={`position:absolute;inset:0;background-image:linear-gradient(rgba(255,107,107,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,107,107,0.05) 1px,transparent 1px);background-size:20px 20px;pointer-events:none`}
        />
        <div
          aria-hidden="true"
          style={`position:absolute;left:32px;right:32px;bottom:36px;border-bottom:1.5px solid rgba(255,107,107,0.35);pointer-events:none`}
        />
        <div
          aria-hidden="true"
          style={`position:absolute;left:24px;bottom:30px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;color:rgba(255,107,107,0.45);font-size:18px;pointer-events:none`}
        >
          ✕
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
          style={`display:block;width:100%;height:200px;touch-action:none;cursor:crosshair`}
        />
        {!hasInk && (
          <div
            style={`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;color:${MUTED};font-size:13px;pointer-events:none;text-align:center;padding:0 16px`}
            aria-hidden="true"
          >
            <div style={`font-size:14px;font-weight:700;color:${TEAL}`}>Draw your signature here</div>
            <div style={`margin-top:4px;font-size:12px;color:${MUTED}`}>finger, stylus, or trackpad — whatever's handy</div>
          </div>
        )}
      </div>

      {/* Typed legal name */}
      <label style={`display:block;margin-top:18px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-bottom:6px`}>Type your full legal name</label>
      <input
        type="text"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        placeholder="Jane Doe"
        autoComplete="name"
        style={`width:100%;padding:14px 16px;border:1px solid ${LINE};border-radius:12px;font-size:16px;color:${INK};font-family:inherit;background:#fff;box-sizing:border-box`}
        required
      />
      <div style={`margin-top:8px;font-size:12px;color:${MUTED}`}>
        By drawing your signature and typing your name, you agree this is your legal e-signature on the contract above.
      </div>

      {err && (
        <div style={`margin-top:12px;color:#b3261e;font-size:13px`}>Couldn't sign — {err}</div>
      )}

      <button
        type="submit"
        disabled={submitting || !name.trim() || !hasInk}
        style={`margin-top:18px;width:100%;background:${submitting || !name.trim() || !hasInk ? "#a8c8a0" : `linear-gradient(135deg,${GREEN} 0%,#71a85f 100%)`};color:#fff;border:0;font-weight:800;font-size:16px;padding:18px 28px;border-radius:14px;box-shadow:${submitting || !name.trim() || !hasInk ? "none" : "0 10px 22px -6px rgba(81,152,67,0.55)"};cursor:${submitting || !name.trim() || !hasInk ? "default" : "pointer"};transition:transform 160ms;display:flex;align-items:center;justify-content:center;gap:10px`}
      >
        {submitting
          ? "Signing…"
          : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l9 2-2-9-9-9-7 7z" /><path d="M14 5l5 5" /></svg>
              <span>{hasInk && name.trim() ? "Looks good — sign the contract →" : "Draw + type your name to enable"}</span>
            </>
          )}
      </button>
    </form>
  );
}
