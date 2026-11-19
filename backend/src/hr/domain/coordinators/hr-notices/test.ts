/**
 * REQ-1003 (LOOP-007 q1, q1-88) — the new hire's email names the business that is hiring them.
 * The invite/reminder email strings render with the company the hire is joining, in both
 * dictionaries; today only reminderBody has a {company} slot.
 */
import { assertStringIncludes } from "#std/assert";
import { type Lang, t } from "@core/i18n/mod.ts";

const v = {
  first: "Jose",
  company: "Reyes Lawn & Landscape",
  url: "https://documonster.com/sign/tok",
};

for (const lang of ["en", "es"] as Lang[]) {
  for (
    const key of [
      "hr.email.inviteSubject",
      "hr.email.inviteHeadline",
      "hr.email.inviteBody",
      "hr.email.reminderSubject",
    ]
  ) {
    Deno.test(`REQ-1003 ${lang} ${key} names the hiring business`, () => {
      assertStringIncludes(t(lang, key, v), v.company);
    });
  }
}

/**
 * REQ-1169 (LOOP-007 q3, q3-103) — AMENDMENT of REQ-884b / REQ-1003, citing REQ-1033 + REQ-628:
 * the HR emails use the house email layout every other DocuMonster email uses. Today
 * HrNotices.sendLink (invite + 24-hour reminder) and notifyComplete write a bare
 * `<div style="font-family:Arial,sans-serif;max-width:520px;…">` with a `<h2>` and a
 * `background:#1a8e40` pill: no `<!doctype html>\n<html lang>` (REQ-1033), no business
 * logo/wordmark (REQ-628), no cream #f7f6f1 body, no #144852 headline/CTA.
 * Driven through the real HrNotices with in-memory collaborators; the HTML handed to
 * EmailService.send is what is checked.
 */
import { assertEquals } from "#std/assert";
import { HrNotices } from "@hr/domain/coordinators/hr-notices/mod.ts";
import type { Hire } from "@hr/dto/hr.ts";

const BIZ = "Reyes Lawn & Landscape";

function noticesFor(lang: Lang) {
  const sent: { to: string; htmlBody: string }[] = [];
  const users = {
    get: () =>
      Promise.resolve({
        name: "Maria Reyes",
        email: "maria@example.com",
        language: lang,
      }),
  };
  const identities = { get: () => Promise.resolve({ businessName: BIZ }) };
  // notifyOnComplete is off by default (REQ-889a); the owner turned it on
  const settingsStore = {
    find: () => Promise.resolve({ notifyOnComplete: true }),
  };
  const hires = {};
  const sms = { send: () => Promise.resolve({ ok: true }) };
  const email = {
    send: (i: { to: string; htmlBody: string }) => {
      sent.push(i);
      return Promise.resolve({ ok: true });
    },
  };
  // the collaborators are in-memory stand-ins; HrNotices itself is the real code
  const Notices = HrNotices as unknown as new (...deps: unknown[]) => HrNotices;
  const n = new Notices(users, identities, settingsStore, hires, sms, email);
  return { n, sent };
}

const hire = {
  id: "h-1",
  userId: "u-1",
  token: "tok",
  firstName: "Jose",
  lastName: "Diaz",
  email: "jose.diaz@example.com",
  phone: "",
  departmentName: "Crew",
  mail: {},
} as unknown as Hire;

/** the facts of the house layout (payment-receipt / decision-alert / send-paperwork-email) */
function shape(html: string, withWordmark: boolean) {
  return {
    root: html.match(/^<!doctype html>\s*<html lang="([^"]*)"[\s>]/i)?.[1] ??
      `(no <html lang>: ${JSON.stringify(html.slice(0, 60))})`,
    creamBody: html.includes("background:#f7f6f1"),
    houseTeal: html.includes("#144852"),
    ...(withWordmark
      ? {
        wordmarkNamesBusiness:
          /<div data-biz-wordmark[^>]*>Reyes Lawn &amp; Landscape<\/div>/.test(
            html,
          ),
      }
      : {}),
    offBrandGreen: html.includes("#1a8e40"),
    bareArialDiv: html.includes("font-family:Arial,sans-serif;max-width:520px"),
  };
}
const house = (lang: Lang, withWordmark: boolean) => ({
  root: lang,
  creamBody: true,
  houseTeal: true,
  ...(withWordmark ? { wordmarkNamesBusiness: true } : {}),
  offBrandGreen: false,
  bareArialDiv: false,
});

for (const lang of ["en", "es"] as Lang[]) {
  for (const kind of ["invite", "reminder"] as const) {
    Deno.test(
      `REQ-1169 (q3-103) the new hire's ${kind} email in "${lang}" uses the house layout: <html lang>, cream card, ${BIZ} wordmark, #144852 — no Arial div, no #1a8e40`,
      async () => {
        const { n, sent } = noticesFor(lang);
        const r = await n.sendLink(hire, kind);
        assertEquals(r.email, true);
        const mail = sent.find((s) => s.to === hire.email)!;
        assertEquals(
          shape(mail.htmlBody, true),
          house(lang, true),
          mail.htmlBody.slice(0, 200),
        );
      },
    );
  }
  Deno.test(
    `REQ-1169 (q3-103) the packet-complete email to HR in "${lang}" uses the house layout: <html lang>, cream card, #144852 — no Arial div`,
    async () => {
      const { n, sent } = noticesFor(lang);
      assertEquals(await n.notifyComplete(hire), true);
      const mail = sent.find((s) => s.to === "maria@example.com")!;
      assertEquals(
        shape(mail.htmlBody, false),
        house(lang, false),
        mail.htmlBody.slice(0, 200),
      );
    },
  );
}
