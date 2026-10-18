/**
 * REQ-083 — Raphael, 2026-10-18, on the /landing2 signup card: "what kind of sexy ass animations
 * can we add to this to make it stand out? really something that goes WOW this is incredible. do it."
 *
 * The guard on the stylesheet and the wiring: every animation is in landing2.css under an `l2-`
 * keyframes name, animates transform/opacity-class properties only (never layout — a card that
 * animates width or top janks on a phone), and one reduced-motion block turns all of it off. The
 * signup island owns the card and talks to the monster island through one DOM event.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const CSS = "front-end/static/landing2.css";
const SIGNUP = "front-end/islands/Landing2Signup.tsx";
const MONSTER = "front-end/islands/Landing2Monster.tsx";
const PAGE = "front-end/routes/landing2.tsx";

const KEYFRAMES = [
  "l2-slam", "l2-shadow-land", "l2-stripe-in", // the entrance
  "l2-digit-in", "l2-charge", // the digits pop, the button charges
  "l2-sms-fly", "l2-flip-out", "l2-flip-in", "l2-bounce", // the text launches, the card flips, the monster bounces
  "l2-slot-in", "l2-shake", // the code types itself, a wrong code shakes
  "l2-draw", "l2-confetti", "l2-takeoff", "l2-fade-in", // the check, the confetti, the takeoff
];
const ALLOWED = new Set(["transform", "opacity", "box-shadow", "stroke-dashoffset", "background-color", "border-color", "filter", "color"]);

describe("REQ-083 the signup card's motion is cheap, complete and switchable", () => {
  test("every animation of the story exists in the stylesheet", () => {
    const css = read(CSS);
    for (const k of KEYFRAMES) expect(css).toMatch(new RegExp(`@keyframes ${k}\\s*\\{`));
  });

  test("the keyframes animate transform/opacity-class properties only — never layout", () => {
    const css = read(CSS);
    const blocks = [...css.matchAll(/@keyframes (l2-[a-z-]+)\s*\{([\s\S]*?)\n\}/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(KEYFRAMES.length);
    for (const [, name, body] of blocks) {
      const props = [...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      const bad = props.filter((p) => !ALLOWED.has(p));
      expect({ name, bad }).toEqual({ name, bad: [] });
    }
  });

  test("one reduced-motion block turns every animation and transition on the page off", () => {
    const css = read(CSS);
    const m = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\.l2 \*,[\s\S]*animation: none !important;[\s\S]*transition: none !important;/);
  });

  test("the signup island owns the card, drives the monster through one DOM event, and both islands honour reduced motion", () => {
    const signup = read(SIGNUP);
    expect(signup).toMatch(/data-cy="l2-signup"/);
    expect(read(PAGE)).not.toMatch(/data-cy="l2-signup"/);
    expect(signup).toMatch(/new CustomEvent\("l2:monster"/);
    expect(signup).toMatch(/prefers-reduced-motion: reduce/);
    expect(signup).toMatch(/data-cy="l2-sms"/);
    expect(signup).toMatch(/data-cy="l2-code-slot"/);
    expect(signup).toMatch(/data-cy="l2-takeoff"/);
    expect(exists(MONSTER)).toBe(true);
    const monster = read(MONSTER);
    expect(monster).toMatch(/addEventListener\("l2:monster"/);
    expect(monster).toMatch(/addEventListener\("mousemove"/);
    expect(monster).toMatch(/prefers-reduced-motion: reduce/);
    expect(monster).toMatch(/data-cy="l2-monster"/);
    expect(read(PAGE)).toMatch(/<Landing2Monster/);
  });
});
