import { useRef, useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import {
  DEMO_DAY_COUNT,
  type DemoDay,
  demoDayLabel,
  demoMonthRange,
  type DemoSlot,
  demoSlotLabel,
} from "../../shared/demo-booking/mod.ts";
import { landingClient } from "../clients/landing.ts";
import type { Lang } from "../lib/lang.ts";
import {
  firstOnView,
  isDrag,
  nearestStop,
  pageTarget,
} from "../lib/day-strip.ts";

/**
 * REQ-090 — the demo card on /landing2, the v3 mock (Raphael, 2026-10-18: "the demo is one card —
 * Llámenme with just a cell books a call as soon as possible, or the person picks one of five
 * days from tomorrow and a morning or afternoon window, name, cell and email, with its own
 * consent box"). Two forms in one card: the one-field form (the cell, Llámenme) and, behind
 * "Mejor elijo día y hora", the day picker (REQ-102, Raphael, 2026-10-20: "calendar days need to
 * slide so that i can pick more than 5 days out. arrow for good ux that is clickable." — every day
 * the route hands down, from tomorrow, Eastern, five at a time between two arrows that slide it a
 * page, or a finger — or a mouse — scrolling it (REQ-105, Raphael, 2026-10-20: "why cant i click
 * and drag the calendar on mobile?" and, on a first cut that flipped a page on the release, "the
 * boxes should render smoothly as you scroll": the strip is a scroller — every day in one row,
 * five to the width, snapping to a day; a finger scrolls it natively, the boxes moving under it;
 * the arrows scroll it a page from wherever it stands; a mouse drags it; a drag never picks the
 * day it started on; front-end/lib/day-strip.ts holds the arithmetic); the pick is the day's
 * index in the whole list, so it outlives the days on view), the two
 * windows, the name, the cell, the email (optional), and a summary that follows every pick. Each posts to POST /demo-request — which emails the team with the consent on record,
 * texts the person and makes the phone a lead — only while the consent box is ticked, and shows
 * the confirmation the mock drew. REQ-097 (Raphael, 2026-10-20: "all the … checkboxes should be
 * ticked"): the box is ticked when the page opens; the person can untick it, and then both forms wait. Every string comes in as `labels` from the route, so the island
 * renders exactly what the server did.
 */
export interface Landing2DemoLabels {
  callMe: string;
  consent: string;
  consentTerms: string;
  pickTimeLink: string;
  quickLink: string;
  pickDay: string;
  /** REQ-102 — the two arrows' names: the page of days before, the page after */
  prevDays: string;
  nextDays: string;
  /** REQ-095 — the window group's name, as the day group has one (REQ-096: the thanks is an h3) */
  pickSlot: string;
  name: string;
  namePh: string;
  phone: string;
  email: string;
  emailPh: string;
  submitDemo: string;
  submitting: string;
  sumDemo: string;
  errName: string;
  errPhoneReq: string;
  errEmailBad: string;
  errConsent: string;
  errSubmit: string;
  errRateDemo: string;
  thanksH: string;
  thanksSub: string;
  thanksNoText: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

type View = "quick" | "pick";

export default function Landing2Demo(
  { lang, labels, days, slots, smsTermsPath }: {
    lang: Lang;
    labels: Landing2DemoLabels;
    days: DemoDay[];
    slots: readonly DemoSlot[];
    /** the SMS terms the consent line links to (LEGAL_LINKS, REQ-076) */
    smsTermsPath: string;
  },
) {
  const [view, setView] = useState<View>("quick");
  /** the picked day: its index in the WHOLE list, so a slide never loses it (REQ-102) */
  const [day, setDay] = useState(0);
  /** REQ-105 — the strip is a scroller: the first day on view, read off its scroll; the arrows and the range follow it */
  const [first, setFirst] = useState(0);
  /** a mouse drag in progress: the view's snapping is off while the button is held */
  const [held, setHeld] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  /** where the last arrow sent the strip, while that scroll still runs — a second click goes on from there, not from midway */
  const aim = useRef<number | null>(null);
  const aimTimer = useRef<number | undefined>(undefined);
  /** the mouse on the strip: where it came down, the scroll it came down at, and whether it has moved past a click's slack */
  const touch = useRef<
    { id: number; x: number; left: number; moved: boolean } | null
  >(null);
  /** the click a drag leaves behind is not a pick: swallowed once, at the capture */
  const swallow = useRef(false);
  const [slot, setSlot] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  /** the consent box: ticked when the page opens (REQ-097); both forms wait while the person has it unticked */
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ texted: boolean } | null>(null);

  const picked = days[day] ?? days[0];
  const window = slots[slot] ?? slots[0];
  const shown = days.slice(first, first + DEMO_DAY_COUNT);

  /** a day's stop is a step from the next: the distance between the first two days' left edges */
  function stepOf(el: HTMLElement): number {
    const d = el.querySelectorAll<HTMLElement>("[data-day]");
    return d.length > 1
      ? d[1].getBoundingClientRect().left - d[0].getBoundingClientRect().left
      : 0;
  }
  /** reduced motion asks for no smooth scroll */
  const calm = (): ScrollBehavior =>
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
  /** REQ-105 — the view scrolled (a finger, a wheel, an arrow, a mouse): which day stands first now */
  function track(e: Event) {
    const el = e.currentTarget as HTMLElement;
    setFirst(firstOnView(el.scrollLeft, stepOf(el)));
  }
  /** the arrows: five on, or five back, from where the strip stands — never past either end */
  function page(dir: -1 | 1) {
    const el = viewRef.current;
    if (!el) return;
    const target = pageTarget(
      aim.current ?? first,
      dir,
      DEMO_DAY_COUNT,
      days.length,
    );
    aim.current = target;
    clearTimeout(aimTimer.current);
    aimTimer.current = setTimeout(() => aim.current = null, 700);
    el.scrollTo({ left: target * stepOf(el) });
  }

  /**
   * A mouse drags the strip: past a click's slack the view takes the pointer and scrolls with it
   * while the button is held — its snapping off, so it follows exactly — and settles on the
   * nearest day when let go. The pointer is taken only then: taken on the press, the mouseup and
   * the click would be retargeted to the view and a plain click would never reach its day. A
   * finger never comes here: the browser scrolls the view itself, the boxes moving under it.
   */
  function grab(e: PointerEvent) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    swallow.current = false;
    touch.current = {
      id: e.pointerId,
      x: e.clientX,
      left: el.scrollLeft,
      moved: false,
    };
  }
  function follow(e: PointerEvent) {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    const el = e.currentTarget as HTMLElement;
    const dx = e.clientX - t.x;
    if (!t.moved && isDrag(dx, 0)) {
      t.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("l2-demo__view--held"); // at once — the render below is a microtask away
      setHeld(true);
    }
    if (!t.moved) return;
    el.scrollLeft = t.left - (e.clientX - t.x);
  }
  function release(e: PointerEvent) {
    const t = touch.current;
    if (!t || e.pointerId !== t.id) return;
    touch.current = null;
    swallow.current = t.moved;
    if (!t.moved) return;
    setHeld(false);
    const el = e.currentTarget as HTMLElement;
    el.scrollTo({
      left: nearestStop(el.scrollLeft, stepOf(el)),
      behavior: calm(),
    });
  }
  function swallowClick(e: MouseEvent) {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  async function post(input: Parameters<typeof landingClient.requestDemo>[0]) {
    setBusy(true);
    try {
      const res = await landingClient.requestDemo(input);
      if (res.ok) {
        setSent({ texted: res.texted });
      } else if (res.reason === "too_many_attempts") {
        setErr(labels.errRateDemo);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "phone"
      ) {
        setErr(labels.errPhoneReq);
      } else if (
        res.reason === "invalid" && "field" in res && res.field === "email"
      ) {
        setErr(labels.errEmailBad);
      } else {
        setErr(labels.errSubmit);
      }
    } catch {
      setErr(labels.errSubmit);
    } finally {
      setBusy(false);
    }
  }

  /** Llámenme: just the cell — a call as soon as possible */
  function submitCall(e: Event) {
    e.preventDefault();
    setErr(null);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) return setErr(labels.errPhoneReq);
    if (!consent) return setErr(labels.errConsent);
    void post({
      mode: "call",
      name: "",
      phone: e164,
      email: "",
      day: "",
      slot: "",
      lang,
      consent: true,
    });
  }

  /** the day, the window and the details — a demo */
  function submitDemo(e: Event) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr(labels.errName);
    const e164 = toE164(phone);
    if (e164.replace(/\D/g, "").length < 10) return setErr(labels.errPhoneReq);
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setErr(labels.errEmailBad);
    if (!consent) return setErr(labels.errConsent);
    void post({
      mode: "demo",
      name: name.trim(),
      phone: e164,
      email: mail,
      day: picked.iso,
      slot: window.id,
      lang,
      consent: true,
    });
  }

  if (sent) {
    return (
      <div class="l2-thanks" data-cy="l2-demo-done">
        <div class="l2-tick" aria-hidden="true">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            stroke-width="3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
        </div>
        <h3 class="l2-h l2-thanks__h">{labels.thanksH}</h3>
        <p class="l2-thanks__sub">
          {sent.texted ? labels.thanksSub : labels.thanksNoText}
        </p>
      </div>
    );
  }

  const consentBox = (
    <label class="l2-consent" for="demo-consent">
      <input
        id="demo-consent"
        type="checkbox"
        checked={consent}
        onChange={(e) => setConsent((e.target as HTMLInputElement).checked)}
      />
      <span>
        {labels.consent}
        <a href={smsTermsPath}>{labels.consentTerms}</a>
      </span>
    </label>
  );

  if (view === "quick") {
    return (
      <form class="l2-stack" onSubmit={submitCall} data-cy="l2-demo-form">
        <div class="l2-demo__row">
          <label for="demo-phone" class="l2-sr">{labels.phone}</label>
          <input
            id="demo-phone"
            class="l2-field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
          <button
            type="submit"
            class="l2-btn l2-btn--dark"
            data-cy="l2-demo-call"
            disabled={busy}
          >
            {busy ? labels.submitting : labels.callMe}
          </button>
        </div>
        {err ? <p class="l2-error" role="alert">{err}</p> : null}
        {consentBox}
        <button
          type="button"
          class="l2-link-btn l2-link-btn--start"
          data-cy="l2-pick-time"
          onClick={() => {
            setErr(null);
            setView("pick");
          }}
        >
          {labels.pickTimeLink}
        </button>
      </form>
    );
  }

  return (
    <form class="l2-stack" onSubmit={submitDemo} data-cy="l2-demo-form">
      <div>
        <div class="l2-demo__dayhead">
          <span class="l2-lbl">{labels.pickDay}</span>
          <span class="l2-demo__range" data-cy="l2-days-range">
            {demoMonthRange(shown)}
          </span>
        </div>
        <div class="l2-demo__strip">
          <button
            type="button"
            class="l2-arrow"
            data-cy="l2-days-prev"
            aria-label={labels.prevDays}
            disabled={first === 0}
            onClick={() => page(-1)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          {/* the view scrolls the row: every day, five to its width, snapping to a day (REQ-105) */}
          <div
            ref={viewRef}
            class={`l2-demo__view${held ? " l2-demo__view--held" : ""}`}
            onScroll={track}
            onPointerDown={grab}
            onPointerMove={follow}
            onPointerUp={release}
            onPointerCancel={release}
            onClickCapture={swallowClick}
          >
            <div class="l2-demo__days" role="group" aria-label={labels.pickDay}>
              {days.map((d, i) => (
                <button
                  type="button"
                  key={d.iso}
                  class={`l2-day ${i === day ? "on" : ""}`}
                  data-cy="l2-day"
                  data-day={d.iso}
                  aria-pressed={i === day}
                  onClick={() => setDay(i)}
                >
                  <span class="l2-day__dow">{d.dow}</span>
                  <span class="l2-day__num">{d.num}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            class="l2-arrow"
            data-cy="l2-days-next"
            aria-label={labels.nextDays}
            disabled={first >= days.length - DEMO_DAY_COUNT}
            onClick={() => page(1)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div class="l2-demo__slots" role="group" aria-label={labels.pickSlot}>
        {slots.map((s, i) => (
          <button
            type="button"
            key={s.id}
            class={`l2-slot ${i === slot ? "on" : ""}`}
            data-cy="l2-slot"
            aria-pressed={i === slot}
            onClick={() => setSlot(i)}
          >
            {s.short[lang]}
          </button>
        ))}
      </div>
      <div class="l2-demo__pair">
        <div>
          <label class="l2-lbl" for="f-name">{labels.name}</label>
          <input
            id="f-name"
            class="l2-field l2-field--sm"
            type="text"
            autoComplete="name"
            placeholder={labels.namePh}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="l2-lbl" for="f-phone">{labels.phone}</label>
          <input
            id="f-phone"
            class="l2-field l2-field--sm"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={formatPhoneInput(phone)}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div>
        <label class="l2-lbl" for="f-email">{labels.email}</label>
        <input
          id="f-email"
          class="l2-field l2-field--sm"
          type="email"
          autoComplete="email"
          placeholder={labels.emailPh}
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
      </div>
      {consentBox}
      <div class="l2-summary" data-cy="l2-demo-summary">
        <strong>{labels.sumDemo}</strong> · {demoDayLabel(picked.iso, lang)} ·
        {" "}
        {demoSlotLabel(window.id, lang)}
      </div>
      {err ? <p class="l2-error" role="alert">{err}</p> : null}
      <button
        type="submit"
        class="l2-btn l2-btn--dark l2-btn--full"
        data-cy="l2-demo-submit"
        disabled={busy}
      >
        {busy ? labels.submitting : labels.submitDemo}
      </button>
      <button
        type="button"
        class="l2-link-btn l2-link-btn--start"
        data-cy="l2-quick-mode"
        onClick={() => {
          setErr(null);
          setView("quick");
        }}
      >
        {labels.quickLink}
      </button>
    </form>
  );
}
