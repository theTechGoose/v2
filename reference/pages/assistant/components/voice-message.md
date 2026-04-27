# `Voice` — Voice memo bubble (waveform + play button)

> ⚠️ **DEFERRED — depends on agents module + audio infrastructure.** Requires:
> - Recording (browser `MediaRecorder` + permission flow)
> - Upload to backend (multipart, see `backend.md` §3.H)
> - Transcription (Whisper or similar via the agents module)
> - Playback (HTMLAudioElement)

## Purpose

Pill-shaped player: small play/pause button on the left, a waveform of ~26 vertical bars in the middle (played portion is colored, unplayed is muted), and a duration label on the right. Plays the recorded user voice memo. The transcript appears as the bubble text once available.

## Source

- JSX: `Paperwork Monsters Assistant.html` lines **4229–4245**
- Inline CSS: search for `.voice`, `.voice__play`, `.voice__wave`, `.voice__bar`, `.voice__bar--played`, `.voice__time`

## JSX (verbatim)

```jsx
const Voice = ({ duration = '0:14', played = 0.6 }) => {
  const bars = Array.from({length: 26}, (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 14);
  const playedIdx = Math.floor(bars.length * played);
  return (
    <div className="voice">
      <button className="voice__play" aria-label="Play">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>
      <div className="voice__wave">
        {bars.map((h, i) => (
          <div key={i} className={`voice__bar ${i < playedIdx ? 'voice__bar--played' : ''}`}
               style={{height: h}}/>
        ))}
      </div>
      <span className="voice__time">{duration}</span>
    </div>
  );
};
```

The waveform bars are **fake** in the prototype — generated from `Math.sin(i * 1.7)`. Production should compute real amplitude-per-time-bucket from the audio file and pass an array of normalized values (or use a fast client-side decoder + `AudioBuffer`).

## CSS (intended structure)

```css
.voice {
  display: inline-grid; grid-template-columns: auto 1fr auto;
  gap: 10px; align-items: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 14px 6px 6px;
  min-width: 220px; max-width: 320px;
}
.msg--user .voice {
  background: var(--brand-green); border-color: transparent;
  color: #fff;
}
.voice__play {
  width: 28px; height: 28px; border-radius: 999px;
  background: var(--brand-green); color: #fff;
  border: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.msg--user .voice__play { background: rgba(255,255,255,0.2); }
.voice__wave {
  display: flex; align-items: center; gap: 2px;
  height: 22px;
}
.voice__bar           { width: 2.5px; background: var(--coffee-300); border-radius: 1px;
                        transition: background 80ms; }
.voice__bar--played   { background: var(--brand-green); }
.msg--user .voice__bar          { background: rgba(255,255,255,0.4); }
.msg--user .voice__bar--played  { background: #fff; }
.voice__time {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--fg-muted);
}
.msg--user .voice__time { color: #fff; }
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/Voice.tsx — island (audio playback)
import { useEffect, useRef, useState } from "preact/hooks";

export function Voice(props: { src: string; bars?: number[]; durationSec: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t,       setT]       = useState(0);

  // Default to a fake waveform if real bars not provided
  const bars = props.bars ?? Array.from({ length: 26 }, (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 14);
  const playedIdx = Math.floor(bars.length * (t / props.durationSec));

  useEffect(() => {
    const el = audio.current!;
    const onTime = () => setT(el.currentTime);
    const onEnd  = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended',     onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended',      onEnd);
    };
  }, []);

  function toggle() {
    const el = audio.current!;
    if (playing) { el.pause(); setPlaying(false); }
    else         { el.play();  setPlaying(true);  }
  }

  return (
    <div class="voice">
      <button class="voice__play" type="button" onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}>
        {playing
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div class="voice__wave" aria-hidden="true">
        {bars.map((h, i) => (
          <div key={i}
               class={`voice__bar ${i < playedIdx ? 'voice__bar--played' : ''}`}
               style={`height:${h}px`} />
        ))}
      </div>
      <span class="voice__time">{fmtTime(t)} / {fmtTime(props.durationSec)}</span>
      <audio ref={audio} src={props.src} preload="metadata" />
    </div>
  );
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}
```

## Props

```ts
type VoiceProps = {
  src:         string;        // signed URL or /api/proxy/files/:id
  durationSec: number;
  bars?:       number[];      // amplitude-per-bucket; defaults to fake sin wave
};
```

## Data source

- `src` — uploaded voice memo, served by the file module (`backend.md` §3.H). Accept `audio/webm`, `audio/mp4`, or `audio/mpeg` (depending on browser).
- `durationSec` — extracted server-side at upload time (e.g., `ffprobe`) or computed client-side via `audio.metadata`.
- `bars` — server-computed amplitude buckets (16 or 26 values normalized 0–1). Optional; falls back to a fake waveform.

## Recording

Out of scope for this doc but worth noting: production needs a recording flow when the user taps the mic in `Composer`. Use `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`, upload the resulting blob, then post a message with `{ type: 'voice', attachmentId }`.

## Island vs server

**Island.** Audio playback + state.

## Accessibility

- Play button needs a clear `aria-label` that updates ("Play" → "Pause").
- Waveform bars are decorative → `aria-hidden="true"`.
- Provide a transcript below or on the next assistant message — SR users rely on it.
- Honor `prefers-reduced-motion`: don't autoplay; require user tap.
- Add keyboard support: Space to toggle, Left/Right to scrub ±5s.

## Edge cases

- **No audio API:** browsers without `MediaRecorder` (rare in 2026) — degrade to "transcript only" without playback.
- **Failed upload:** show a retry chip in the bubble.
- **Long memo (>5min):** UI fine, but suggest the user break it up. Backend caps at 10 min.
- **Network playback:** preload `metadata` only — don't load the whole file until tap.
- **Multiple voices on screen:** ensure only one plays at a time; pause others on play.
- **Transcription latency:** show a "Transcribing…" placeholder under the player; replace with text when ready.
