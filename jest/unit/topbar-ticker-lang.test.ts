/**
 * REQ-496 — demo-loop cycle 3, issue m36: "Top notice stays Spanish ~1.5 s after
 * switching to EN". The ticker showed `tickerItem.title`, a string the server
 * rendered in `user.language` at fetch time (P-59); the EN click flipped the UI
 * at once but the title only changed after the profile PUT and a coalesced
 * refetch (REQ-424, ≤ 1 per 5 s). Now the feed's titleKey/titleParams are
 * rendered client-side in the LIVE language via the shared renderer.
 */
import * as fs from "fs";
import * as path from "path";
import { tickerTitleHtml } from "../../front-end/lib/ticker-pick";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};
const trFor =
  (lang: "en" | "es") =>
  (key: string, vars?: Record<string, string | number>) => {
    const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    return vars
      ? s.replace(
        /\{(\w+)\}/g,
        (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
      )
      : s;
  };

// a row exactly as GET /notifications returned it while user.language was "es"
const paidEs = {
  id: "n-1",
  createdAt: "2026-11-12T05:30:00Z",
  title: "María Pérez pagó $450",
  titleKey: "notify.invoice.paidAmount",
  titleParams: { name: "María Pérez", amountCents: 45000 },
};

describe("REQ-496 the topbar ticker renders the title in the live language (demo m36, cycle 3)", () => {
  test("a Spanish-rendered row reads English the moment the UI is EN — no refetch", () => {
    expect(tickerTitleHtml(paidEs, trFor("en"))).toBe("María Pérez paid $450");
    expect(tickerTitleHtml(paidEs, trFor("es"))).toBe("María Pérez pagó $450");
  });

  test("method and fallback-name params localize too; the title is sentence-cased", () => {
    const claimed = {
      title: "x",
      titleKey: "notify.invoice.claimedVia",
      titleParams: { method: "zelle" },
    };
    expect(tickerTitleHtml(claimed, trFor("en"))).toBe(
      "Your client says they paid via Zelle — confirm you got it",
    );
    expect(tickerTitleHtml(claimed, trFor("es"))).toBe(
      "Tu cliente dice que pagó por Zelle — confirma que lo recibiste",
    );
  });

  test("a legacy row without a key keeps the server's title (markup intact)", () => {
    const legacy = { title: "Quote <b>sent</b>" };
    expect(tickerTitleHtml(legacy, trFor("en"))).toBe("Quote <b>sent</b>");
  });

  test("client-rendered params are HTML-escaped before they reach innerHTML", () => {
    const row = {
      title: "x",
      titleKey: "notify.quote.sent",
      titleParams: { name: "<img src=x onerror=alert(1)> & Co" },
    };
    expect(tickerTitleHtml(row, trFor("en"))).toBe(
      "Quote sent to &lt;img src=x onerror=alert(1)&gt; &amp; Co",
    );
  });

  test("DashTopbar renders the ticker through tickerTitleHtml with the live lang, not the raw title", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/tickerTitleHtml\(\s*tickerItem,/);
    expect(src).toMatch(/tFor\(lang, k, v\)/);
    expect(src).not.toMatch(/html:\s*tickerItem\.title\b/);
  });

  test("the front-end Notification type carries the feed's titleKey/titleParams", () => {
    const src = read("front-end/clients/dashboard.ts");
    expect(src).toMatch(/titleKey\?: string;/);
    expect(src).toMatch(/titleParams\?: Record<string, string \| number>;/);
  });
});
