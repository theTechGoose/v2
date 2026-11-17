/**
 * REQ-589 (demo-loop cycle 4, issues M15 + m15) — the assistant's stored
 * chat lines follow the EN/ES switch.
 *
 * The server used to write the wizard question, its option labels, the
 * "A little more info" divider, the "Start: Next week" pick line, the
 * thread-list preview and the send divider ("Text not delivered" + the SMS
 * reason) already translated, and the island printed them verbatim — so
 * after a switch every old line stayed in the language it was written in.
 * Now each carries `payload.i18n` ({key, vars}); the client re-renders it in
 * the live language through shared/quote-flow/chat-i18n.ts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  type ChatI18nRef,
  localizeChatMessage,
  localizedPreview,
  renderChatI18n,
} from "../../shared/quote-flow/chat-i18n";
import { notificationTitle } from "../../shared/quote-flow/notification-title";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

type Lang = "en" | "es";
const DICTS: Record<Lang, Record<string, string>> = { en, es };
function tFor(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const v = DICTS[lang][key] ?? en[key] ?? key;
  return vars
    ? v.replace(
      /\{(\w+)\}/g,
      (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
    )
    : v;
}

describe("REQ-589 chat lines re-render from their i18n key (M15 / m15)", () => {
  test("REQ-589 a pick line written in Spanish reads in English after the switch", () => {
    const ref: ChatI18nRef = {
      key: "wizardAnswer.pick.transcript",
      vars: {
        label: { key: "termsWizard.startDate.label" },
        value: { key: "termsWizard.startDate.nextWeek" },
      },
    };
    expect(renderChatI18n(ref, "es", tFor)).toBe("Inicio: La próxima semana");
    expect(renderChatI18n(ref, "en", tFor)).toBe("Start: Next week");
  });

  test("REQ-589 a picked date re-formats in the reader's language; a typed name passes through", () => {
    const date: ChatI18nRef = {
      key: "wizardAnswer.pick.transcript",
      vars: {
        label: { key: "termsWizard.startDate.label" },
        value: { date: "2026-12-01" },
      },
    };
    expect(renderChatI18n(date, "en", tFor)).toBe("Start: Dec 1, 2026");
    expect(renderChatI18n(date, "es", tFor)).toBe("Inicio: 1 dic 2026");
    const name: ChatI18nRef = {
      key: "wizardAnswer.pick.transcriptAddress",
      vars: {
        label: { key: "termsWizard.customer.label" },
        value: "Carmen Ruiz",
        address: "12 Elm St",
      },
    };
    expect(renderChatI18n(name, "en", tFor)).toBe(
      `${en["termsWizard.customer.label"]}: Carmen Ruiz — 12 Elm St`,
    );
  });

  test("REQ-589 AMENDMENT (REQ-585) a custom duration worded per language reads in the reader's language", () => {
    const ref: ChatI18nRef = {
      key: "wizardAnswer.pick.transcript",
      vars: {
        label: { key: "termsWizard.wraps.label" },
        value: { byLang: { en: "2.5 weeks", es: "2.5 semanas" } },
      },
    };
    expect(renderChatI18n(ref, "en", tFor)).toBe(
      `${en["termsWizard.wraps.label"]}: 2.5 weeks`,
    );
    expect(renderChatI18n(ref, "es", tFor)).toBe(
      `${es["termsWizard.wraps.label"]}: 2.5 semanas`,
    );
  });

  test("REQ-589 a wizard question, its options and the phase divider follow the live language", () => {
    const wizard = {
      id: "w1",
      kind: "wizard",
      content: "¿Cuándo empieza el trabajo?",
      payload: {
        stepId: "start_date",
        i18n: { key: "termsWizard.startDate.question" },
        options: [
          {
            id: "next_week",
            label: "La próxima semana",
            i18n: { label: "termsWizard.startDate.nextWeek" },
          },
          { id: "legacy", label: "Sin clave" },
        ],
      },
    };
    const out = localizeChatMessage(wizard, "en", tFor);
    expect(out.content).toBe("When does the job start?");
    const opts = (out.payload as { options: { label: string }[] }).options;
    expect(opts[0].label).toBe("Next week");
    // A legacy option without a key keeps its stored label.
    expect(opts[1].label).toBe("Sin clave");
    // The input is not mutated (React state).
    expect(wizard.content).toBe("¿Cuándo empieza el trabajo?");

    const divider = {
      id: "d1",
      kind: "phase_divider",
      content: "Un poco más de información",
      payload: {
        phase: 2,
        label: "Un poco más de información",
        i18n: { key: "transitionToTerms.phaseDivider" },
      },
    };
    const d = localizeChatMessage(divider, "en", tFor);
    expect(d.content).toBe("A little more info");
    expect((d.payload as { label: string }).label).toBe("A little more info");
  });

  test("REQ-589 m15: the send divider's label and SMS reason follow the switch", () => {
    const divider = {
      id: "s1",
      kind: "phase_divider",
      content: "Text not delivered",
      payload: {
        phase: 3,
        label: "Text not delivered",
        i18n: { key: "sendQuote.divider.textNotDelivered" },
        smsFailureReason: en["sms.fictionalNumber"],
        smsFailureI18n: { key: "sms.fictionalNumber" },
        smsFailureCode: "fictional",
      },
    };
    const d = localizeChatMessage(divider, "es", tFor);
    const p = d.payload as { label: string; smsFailureReason: string };
    expect(p.label).toBe(es["sendQuote.divider.textNotDelivered"]);
    expect(p.smsFailureReason).toBe(es["sms.fictionalNumber"]);
  });

  test("REQ-589 a legacy row with no key renders exactly as stored", () => {
    const legacy = {
      id: "x",
      kind: "text",
      content: "Inicio: La próxima semana",
    };
    expect(localizeChatMessage(legacy, "en", tFor)).toBe(legacy);
  });

  test("REQ-589 the thread-list preview re-renders from previewI18n, else the stored text", () => {
    const conv = {
      preview: "Inicio: La próxima semana",
      previewI18n: {
        key: "wizardAnswer.pick.transcript",
        vars: {
          label: { key: "termsWizard.startDate.label" },
          value: { key: "termsWizard.startDate.nextWeek" },
        },
      },
    };
    expect(localizedPreview(conv, "en", tFor)).toBe("Start: Next week");
    expect(localizedPreview({ preview: "hola" }, "en", tFor)).toBe("hola");
    expect(localizedPreview({}, "en", tFor)).toBeUndefined();
  });

  test("REQ-589 m15: a feed row names the job in the reader's language", () => {
    const row = {
      title: "María accepted your quote for Furniture Removal",
      titleKey: "notify.quote.acceptedJob",
      titleParams: {
        name: "María",
        job: "Furniture Removal",
        job_en: "Furniture Removal",
        job_es: "Retiro de muebles",
      },
    };
    expect(
      notificationTitle((k, v) => tFor("es", k, v), row, "es"),
    ).toContain("Retiro de muebles");
    expect(
      notificationTitle((k, v) => tFor("en", k, v), row, "en"),
    ).toContain("Furniture Removal");
    // Without a per-language name it keeps the one it has.
    const { job_en: _a, job_es: _b, ...plain } = row.titleParams;
    expect(
      notificationTitle((k, v) => tFor("es", k, v), {
        ...row,
        titleParams: plain,
      }, "es"),
    ).toContain("Furniture Removal");
  });

  test("REQ-589 the island renders chat lines and previews through the shared localizer", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toMatch(/localizeChatMessage\(\s*\w+,\s*lang,\s*tFor\s*\)/);
    const threads = read("front-end/islands/AsstThreads.tsx");
    expect(threads).toMatch(/localizedPreview\(\s*c,\s*lang,\s*tFor\s*\)/);
    const topbar = read("front-end/islands/DashTopbar.tsx");
    expect(topbar).toMatch(
      /tickerTitleHtml\(\s*tickerItem,[^;]*?\),\s*lang,?\s*\)/,
    );
    const ticker = read("front-end/lib/ticker-pick.ts");
    expect(ticker).toMatch(/notificationTitle\(tr, item, lang\)/);
  });
});
