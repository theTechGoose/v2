/**
 * REQ-1125 — LOOP-007 cycle 3, QA issue q3-53 [BUG_POLISH]: the Overdue card's
 * "OVERDUE" pill on /invoices was white text on a white pill.
 *
 * `.qcard__status` (static/quotes.css) paints every stage's pill with the same
 * near-opaque white (`rgba(255,255,255,0.92)`) and takes its text colour from
 * `--mood-status`, which the cards set from `STAGE_MOOD[stage].statusFg`
 * (islands/InvoicesPage.tsx) and `STATUS_MOOD[status].statusFg`
 * (islands/PaymentsPage.tsx). Every stage label must read at WCAG AA (4.5:1)
 * against that pill composited over either end of the card's gradient.
 *
 * The mood tables are module-private island constants, so — like
 * backdrop-overlays / job-details-pencil — this reads the real source.
 */
import { assert } from "@std/assert";

const FE = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, FE));

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function lum([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const over = (top: RGB, alpha: number, under: RGB): RGB =>
  top.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha))) as RGB;

/** The pill background from the real `.qcard__status` rule. */
function pillBackground(): { rgb: RGB; alpha: number } {
  const css = read("static/quotes.css");
  const rule = css.match(/\.qcard__status\s*\{([^}]*)\}/);
  assert(rule, ".qcard__status rule found in static/quotes.css");
  const bg = rule[1].match(
    /background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
  );
  assert(bg, `.qcard__status background is an rgba() (${rule[1]})`);
  return {
    rgb: [Number(bg[1]), Number(bg[2]), Number(bg[3])],
    alpha: Number(bg[4]),
  };
}

type Mood = { name: string; from: string; to: string; statusFg: string };

/** Each `name: { from: "#..", to: "#..", ..., statusFg: "#.." }` entry of a mood table. */
function moods(src: string, table: string): Mood[] {
  const start = src.indexOf(`const ${table}:`);
  assert(start >= 0, `${table} declared`);
  const body = src.slice(start, src.indexOf("\n};", start));
  const out: Mood[] = [];
  const re = /\n\s{2}(\w+):\s*\{([^}]*)\}/g;
  for (const m of body.matchAll(re)) {
    const get = (k: string) =>
      m[2].match(new RegExp(`${k}:\\s*"(#[0-9A-Fa-f]{3,6})"`))?.[1];
    const from = get("from"), to = get("to"), statusFg = get("statusFg");
    if (from && to && statusFg) out.push({ name: m[1], from, to, statusFg });
  }
  return out;
}

function failures(moodList: Mood[]): string[] {
  const pill = pillBackground();
  const bad: string[] = [];
  for (const m of moodList) {
    for (const end of [m.from, m.to]) {
      const bg = over(pill.rgb, pill.alpha, parseHex(end));
      const ratio = contrast(parseHex(m.statusFg), bg);
      if (ratio < 4.5) {
        bad.push(
          `${m.name}: statusFg ${m.statusFg} on pill rgb(${
            bg.join(",")
          }) (over ${end}) = ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
  return bad;
}

Deno.test("REQ-1125 (LOOP-007 q3-53): every /invoices stage pill label (STAGE_MOOD.statusFg) reads at >= 4.5:1 on the white .qcard__status pill — OVERDUE is not white on white", () => {
  const list = moods(read("islands/InvoicesPage.tsx"), "STAGE_MOOD");
  assert(list.some((m) => m.name === "overdue"), "STAGE_MOOD.overdue parsed");
  assert(
    list.length >= 8,
    `all invoice stages parsed (${list.map((m) => m.name)})`,
  );
  const bad = failures(list);
  assert(
    bad.length === 0,
    `unreadable invoice stage pills:\n  ${bad.join("\n  ")}`,
  );
});

Deno.test("REQ-1125 (LOOP-007 q3-53): every /payments card pill label (STATUS_MOOD.statusFg) reads at >= 4.5:1 on the white .qcard__status pill — 'attention' is not white on white", () => {
  const list = moods(read("islands/PaymentsPage.tsx"), "STATUS_MOOD");
  assert(
    list.some((m) => m.name === "attention"),
    "STATUS_MOOD.attention parsed",
  );
  assert(
    list.length >= 3,
    `all payment moods parsed (${list.map((m) => m.name)})`,
  );
  const bad = failures(list);
  assert(
    bad.length === 0,
    `unreadable payment status pills:\n  ${bad.join("\n  ")}`,
  );
});
