# `DemoPhoneChat` — iPhone mockup with scroll-revealed chat

## Purpose

Two-column section: left is a testimonial card (border-left pink, italic quote, avatar+role footer); right is a 320×580 px iPhone-frame mockup containing a scripted chat conversation between a contractor and the Paperwork Monsters assistant. The chat reveals message-by-message when the phone scrolls into view, with typing indicators that disappear when the next bubble appears, and a progress bar at the top of the screen that fills as the conversation advances. The conversation ends with an inline "quote card" rich bubble.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2275–2329**
- CSS: `styles.css` lines **732–952**
- JS: `Paperwork Monsters Landing.html` lines **343–462** (chat data + render + reveal sequencer)

## HTML (verbatim)

```html
<section class="demo">
  <div class="container demo-grid">

    <div class="demo-info">
      <span class="eyebrow-pill" data-i18n="demo.eyebrow">See it in action</span>
      <h2 data-i18n="demo.h2">Just text us. We handle the rest.</h2>
      <p data-i18n="demo.lead">Quotes, contracts, invoices — sent from your phone in seconds. No app to download. No software to learn.</p>

      <div class="testimonial">
        <span class="quote-mark">"</span>
        <p data-i18n="demo.quote">I used to spend my Sundays writing quotes on notebook paper. Now I text these guys the job details from my truck and get a professional quote back in minutes. My close rate went through the roof.</p>
        <div class="who">
          <div class="av">MR</div>
          <div>
            <strong>Mike R.</strong>
            <span data-i18n="demo.role">General Contractor · 12 years</span>
          </div>
        </div>
      </div>
    </div>

    <div class="phone-wrap">
      <div class="phone-bg"></div>
      <div class="phone">
        <div class="phone-screen">
          <div class="phone-status">
            <span>9:41</span>
            <div class="icons"><span></span><span></span><span></span><span></span></div>
          </div>

          <div class="chat-header">
            <div class="av-pm"><img src="/logo-monster.png" alt=""/></div>
            <div class="meta">
              <strong>Paperwork Monsters</strong>
              <span data-i18n="demo.online">Online</span>
            </div>
          </div>

          <div class="chat-progress"><div class="fill" id="chat-fill"></div></div>

          <div class="chat-body" id="chat-body">
            <!-- chat steps populated by JS -->
          </div>

          <div class="chat-input">
            <div class="field" data-i18n="demo.message">Message</div>
            <div class="send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</section>
```

## Static seed (verbatim — `Landing.html:346–375`)

```js
const chatScript = {
  en: [
    { side: 'right', kind: 'bubble', cls: 'me',   text: 'Kitchen remodel for the Hernández family. Cabinets, quartz counters, 3 days labor.' },
    { side: 'right', kind: 'meta',                text: '9:38 AM' },
    { side: 'left',  kind: 'typing' },
    { side: 'left',  kind: 'bubble', cls: 'them', text: 'Got it 👍 What zip code is the job in?' },
    { side: 'left',  kind: 'bubble', cls: 'them', text: 'And rough square footage of countertop?' },
    { side: 'right', kind: 'bubble', cls: 'me',   text: '78704. About 42 sq ft of counter.' },
    { side: 'left',  kind: 'typing' },
    { side: 'left',  kind: 'bubble', cls: 'them', text: 'Perfect. Quote coming up — typical range for this is $10,800–$12,400.' },
    { side: 'left',  kind: 'bubble', cls: 'them', text: "Here's your quote, ready to send:", style: 'background:var(--mint-200)' },
    { side: 'right', kind: 'quote' },
    { side: 'right', kind: 'bubble', cls: 'me',   text: 'Looks good. Send it to them.' },
    { side: 'right', kind: 'meta',                text: '9:41 AM ✓ Sent to client' },
  ],
  es: [ /* mirror — see Landing.html:362–374 */ ],
};

const quoteCardHTML = (lang) => {
  const t = lang === 'es'
    ? { hd: 'Cotización · #PM-2641', l1: 'Gabinetes e instalación', l2: 'Cubiertas de cuarzo', l3: 'Demolición y mano de obra', total: 'Total' }
    : { hd: 'Quote · #PM-2641',      l1: 'Cabinets & install',      l2: 'Quartz countertops',  l3: 'Demo & labor',           total: 'Total' };
  return `
    <div class="quote-card">
      <div class="qc-head"><span>${t.hd}</span><span class="pdf">PDF</span></div>
      <div class="row"><span>${t.l1}</span><strong>$ 4,200</strong></div>
      <div class="row"><span>${t.l2}</span><strong>$ 3,990</strong></div>
      <div class="row"><span>${t.l3}</span><strong>$ 2,800</strong></div>
      <div class="total"><span>${t.total}</span><span>$ 10,990</span></div>
    </div>`;
};
```

## CSS (verbatim — key rules)

### Demo layout & testimonial

```css
.demo { padding: 110px 0; }
.demo-grid { display: grid; grid-template-columns: 1fr 1.1fr; gap: 64px; align-items: center; }

.demo-info h2 {
  font-family: var(--font-heading); font-weight: 800;
  font-size: clamp(32px, 4vw, 48px); line-height: 1.05;
  color: var(--brand-teal); margin: 18px 0 16px;
  letter-spacing: -0.025em;
}
.demo-info p { font-size: 17px; color: var(--fg-muted); line-height: 1.6; margin: 0 0 28px; }

.testimonial {
  background: var(--mint-200);
  border-left: 4px solid var(--brand-pink);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  position: relative;
}
.testimonial .quote-mark {
  font-family: var(--font-heading); font-weight: 800;
  font-size: 64px; line-height: 0.5;
  color: var(--brand-pink); opacity: 0.5;
  position: absolute; top: 26px; right: 24px;
}
.testimonial p             { margin: 0 0 16px; font-size: 16px;
                             line-height: 1.55; color: var(--brand-teal);
                             font-style: italic; }
.testimonial .who          { display: flex; align-items: center; gap: 12px; }
.testimonial .who .av      { width: 44px; height: 44px; border-radius: 999px;
                             background: var(--brand-teal); color: #fff;
                             display: flex; align-items: center; justify-content: center;
                             font-family: var(--font-heading); font-weight: 800; font-size: 16px; }
.testimonial .who div          { font-size: 14px; }
.testimonial .who div strong   { display: block; color: var(--brand-teal); font-family: var(--font-heading); font-weight: 800; font-size: 15px; }
.testimonial .who div span     { color: var(--fg-muted); }
```

### Phone frame + screen

```css
.phone-wrap { position: relative; display: flex; justify-content: center; }
.phone-bg   { position: absolute; inset: 20px -40px;
              background: radial-gradient(ellipse at center, rgba(207,229,200, 0.6) 0%, transparent 60%);
              pointer-events: none; z-index: 0; }
.phone {
  position: relative; z-index: 1;
  width: 320px; background: #1a1a1a;
  border-radius: 44px;
  padding: 12px;
  box-shadow: 0 30px 60px rgba(100, 69, 54, 0.25), 0 0 0 1px rgba(0,0,0,0.05);
}
.phone-screen {
  background: var(--mint-100); border-radius: 32px; overflow: hidden;
  height: 580px;
  display: flex; flex-direction: column;
  position: relative;                           /* for chat-progress positioning */
}
.phone-status {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 24px 8px;
  font-family: var(--font-heading); font-weight: 800; font-size: 13px;
  color: var(--brand-teal);
}
.phone-status .icons         { display: flex; gap: 6px; }
.phone-status .icons span    { display: inline-block; width: 4px; height: 12px;
                                background: var(--brand-teal); border-radius: 1px; }
.phone-status .icons span:nth-child(1) { height: 6px; }
.phone-status .icons span:nth-child(2) { height: 8px; }
.phone-status .icons span:nth-child(3) { height: 10px; }
.phone-status .icons span:nth-child(4) { height: 12px; }
```

### Chat header / body / bubbles / typing / quote-card / input

```css
.chat-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
.chat-header .av-pm     { width: 36px; height: 36px; border-radius: 999px;
                          background: var(--brand-green);
                          display: flex; align-items: center; justify-content: center;
                          overflow: hidden; }
.chat-header .av-pm img { width: 28px; height: 28px; }
.chat-header .meta      { line-height: 1.2; }
.chat-header .meta strong { font-family: var(--font-heading); font-weight: 800;
                             font-size: 13px; color: var(--brand-teal); display: block; }
.chat-header .meta span   { font-size: 11px; color: var(--brand-green);
                             display: inline-flex; align-items: center; gap: 4px; }
.chat-header .meta span::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: var(--brand-green); }

.chat-progress {
  position: absolute;
  top: 60px; left: 0; right: 0;
  height: 3px;
  background: rgba(100,69,54,0.08);
  overflow: hidden;
}
.chat-progress .fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, var(--brand-pink), var(--brand-green));
  transition: width 400ms ease;
}

.chat-body {
  flex: 1; padding: 16px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
  background: linear-gradient(180deg, var(--mint-100) 0%, #fff 100%);
}

.bubble        { max-width: 78%; padding: 10px 14px; border-radius: 18px;
                 font-size: 14px; line-height: 1.4; font-family: var(--font-body); }
.bubble.them   { background: #fff; color: var(--brand-teal);
                 border-bottom-left-radius: 4px;
                 align-self: flex-start;
                 box-shadow: 0 2px 4px rgba(100,69,54,0.06); }
.bubble.me     { background: var(--brand-green); color: #fff;
                 border-bottom-right-radius: 4px;
                 align-self: flex-end; }

.chat-step {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
  transition: opacity 320ms ease, transform 360ms cubic-bezier(0.34,1.4,0.64,1);
  display: flex; flex-direction: column; gap: 6px;
}
.chat-step.in       { opacity: 1; transform: translateY(0) scale(1); }
.chat-step .bubble  { align-self: flex-start; }
.chat-step.right .bubble,
.chat-step.right .quote-card,
.chat-step.right .bubble-meta { align-self: flex-end; }
.chat-step.right { align-items: flex-end; }
.chat-step.left  { align-items: flex-start; }

.typing {
  display: inline-flex; gap: 4px;
  background: #fff; padding: 12px 14px; border-radius: 18px;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 4px rgba(100,69,54,0.06);
  align-self: flex-start;
}
.typing span { width: 6px; height: 6px; border-radius: 999px;
               background: var(--coffee-300);
               animation: typingBounce 1.2s ease-in-out infinite; }
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0);   opacity: 0.5; }
  30%           { transform: translateY(-4px); opacity: 1;   }
}

.bubble-meta { font-size: 10px; color: var(--fg-subtle);
               margin-top: 2px; align-self: flex-end;
               font-family: var(--font-heading); font-weight: 700; }

.quote-card {
  background: #fff;
  border-radius: 14px;
  padding: 12px;
  margin-top: 4px;
  align-self: flex-end;
  width: 80%;
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(100,69,54,0.1);
}
.quote-card .qc-head {
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--font-heading); font-weight: 800;
  color: var(--brand-teal); font-size: 12px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.quote-card .qc-head .pdf { font-size: 9px; background: var(--brand-pink); color: #fff;
                            padding: 2px 6px; border-radius: 4px; }
.quote-card .row    { display: flex; justify-content: space-between;
                      font-size: 11px; padding: 2px 0; color: var(--fg-muted); }
.quote-card .row strong { color: var(--brand-teal); font-family: var(--font-heading); font-weight: 800; }
.quote-card .total {
  display: flex; justify-content: space-between;
  font-family: var(--font-heading); font-weight: 800;
  color: var(--brand-pink); font-size: 14px;
  padding-top: 6px; margin-top: 4px;
  border-top: 1.5px solid var(--brand-teal);
}

.chat-input {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border-top: 1px solid var(--border);
}
.chat-input .field { flex: 1; background: var(--mint-200);
                     border-radius: 999px; padding: 8px 14px;
                     font-size: 13px; color: var(--fg-subtle); }
.chat-input .send  { width: 32px; height: 32px; border-radius: 999px;
                     background: var(--brand-green); color: #fff;
                     display: flex; align-items: center; justify-content: center; }
```

## JS (verbatim — render + reveal sequencer)

```js
function renderChat() {
  const body = document.getElementById('chat-body');
  body.innerHTML = '';
  chatScript[curLang].forEach((s, i) => {
    const step = document.createElement('div');
    step.className = 'chat-step ' + s.side;
    step.dataset.idx = i;
    if      (s.kind === 'bubble') {
      const b = document.createElement('div');
      b.className = 'bubble ' + s.cls;
      b.textContent = s.text;
      if (s.style) b.style.cssText = s.style;
      step.appendChild(b);
    }
    else if (s.kind === 'meta') {
      const m = document.createElement('div'); m.className = 'bubble-meta';
      m.textContent = s.text; step.appendChild(m);
    }
    else if (s.kind === 'typing') {
      const t = document.createElement('div'); t.className = 'typing';
      t.innerHTML = '<span></span><span></span><span></span>'; step.appendChild(t);
    }
    else if (s.kind === 'quote') {
      step.innerHTML = quoteCardHTML(curLang);
    }
    body.appendChild(step);
  });
  resetReveal();
}
window.renderChat = renderChat;

let revealTimers = [];
let revealed = 0;
function resetReveal() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
  revealed = 0;
  document.querySelectorAll('.chat-step').forEach(s => s.classList.remove('in'));
  document.getElementById('chat-fill').style.width = '0%';
}
function startReveal() {
  const steps = [...document.querySelectorAll('.chat-step')];
  if (!steps.length || revealed) return;
  const body = document.getElementById('chat-body');
  let delay = 0;
  steps.forEach((step, i) => {
    const isTyping = step.querySelector('.typing');
    delay += isTyping ? 350 : (i === 0 ? 200 : 700);
    revealTimers.push(setTimeout(() => {
      step.classList.add('in');
      // hide previous typing once a real bubble appears
      if (!isTyping && i > 0) {
        const prev = steps[i - 1];
        if (prev.querySelector('.typing')) prev.style.display = 'none';
      }
      body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
      const pct = Math.round(((i + 1) / steps.length) * 100);
      document.getElementById('chat-fill').style.width = pct + '%';
    }, delay));
    if (isTyping) delay += 1100;                 // typing dwell
  });
  revealed = 1;
}

new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) startReveal();
    else                   resetReveal();          // resets so re-scrolling re-plays
  });
}, { threshold: 0.4 }).observe(document.querySelector('.phone'));
```

## Preact / Fresh translation

```tsx
// v2/frontend/islands/DemoPhoneChat.tsx — island

import { useEffect, useRef, useState } from "preact/hooks";
import { langSignal } from "../lib/lang-signal.ts";
import { CHAT_SCRIPT, QUOTE_CARD } from "../lib/landing-chat.ts";

type Step =
  | { side: 'left'|'right', kind: 'bubble', cls: 'me'|'them', text: string, bg?: string }
  | { side: 'left'|'right', kind: 'meta',   text: string }
  | { side: 'left'|'right', kind: 'typing' }
  | { side: 'left'|'right', kind: 'quote' };

export function DemoPhoneChat() {
  const lang = langSignal.value;
  const steps = CHAT_SCRIPT[lang] as Step[];

  const phoneRef = useRef<HTMLDivElement>(null);
  const bodyRef  = useRef<HTMLDivElement>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [pct, setPct] = useState(0);
  const timers = useRef<number[]>([]);

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRevealedCount(0);
    setPct(0);
  }
  function start() {
    if (revealedCount > 0) return;
    let delay = 0;
    steps.forEach((s, i) => {
      const isTyping = s.kind === 'typing';
      delay += isTyping ? 350 : (i === 0 ? 200 : 700);
      timers.current.push(setTimeout(() => {
        setRevealedCount(i + 1);
        setPct(Math.round(((i + 1) / steps.length) * 100));
        bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
      }, delay));
      if (isTyping) delay += 1100;
    });
  }

  useEffect(() => {
    if (!phoneRef.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start();
      else reset();
    }, { threshold: 0.4 });
    io.observe(phoneRef.current);
    return () => io.disconnect();
  }, [lang]);

  // Hide a typing indicator when its successor reveals
  function visible(idx: number): boolean {
    if (idx >= revealedCount) return false;
    const next = steps[idx + 1];
    if (steps[idx].kind === 'typing' && next && idx + 1 < revealedCount) return false;
    return true;
  }

  return (
    <div ref={phoneRef} class="phone /* … 320×580 frame … */">
      {/* … status bar / chat header / chat-progress / chat-body / chat-input … */}
      <div ref={bodyRef} class="chat-body">
        {steps.map((s, i) => (
          <div data-idx={i}
               class={`chat-step ${s.side} ${visible(i) ? 'in' : ''}`}
               style={!visible(i) && s.kind === 'typing' && i + 1 < revealedCount ? 'display:none' : ''}>
            { /* render bubble | meta | typing | quote … */ }
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Props

```ts
type DemoPhoneChatProps = {};
```

## Data source

Static script (`CHAT_SCRIPT`). The chat content is **decorative marketing**, not a real conversation. Do not connect to any backend.

## Island vs server

**Island.** IntersectionObserver + timers + DOM measurement. The testimonial card stays as a server-rendered sibling (left column).

## Accessibility

- Phone frame + chat content is **decorative storytelling**. Mark `aria-hidden="true"` on the entire `<div class="phone-wrap">` so SR users skip the simulated conversation.
- Provide a static screen-reader-only summary above: `<p class="sr-only">Demo: a contractor texts the assistant about a kitchen remodel. The assistant asks for the zip code and square footage, then sends back a $10,990 quote.</p>`
- Honor `prefers-reduced-motion`: skip the timed reveal and render all steps in their final state immediately. Add `if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setRevealedCount(steps.length); setPct(100); return; }` at the top of `start()`.

## Edge cases

- **Scroll past then back:** the IO `else reset()` branch un-fires the reveal so re-scrolling replays the conversation. **Recommended for production:** keep this — the replay is delightful.
- **Lang switch mid-reveal:** `useEffect` is keyed on `lang`, so timers are cleared and the script restarts in the new language.
- **Below 980px:** demo grid → 1 column (`styles.css:1169`); phone is centered, testimonial above.
- **Phone overflow:** `chat-body { overflow-y: auto }` so long conversations scroll inside the phone. Current 12-step script fits.
- **Photo of logo in chat-header:** `<img src="/logo-monster.png">` — same asset as nav. Re-use, don't duplicate.
- **The `meta` lines (e.g. "9:41 AM ✓ Sent to client") are not bubbles** — they're tiny right-aligned timestamps. Render with `.bubble-meta` class.
- **The `quote-card` step is a rich bubble**, not a separate kind — but visually it's a card. Render as `<div class="quote-card">` inside the chat-step (no `.bubble` wrapper).
