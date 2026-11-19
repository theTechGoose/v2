/**
 * REQ-1003 (LOOP-007 q1, q1-88) — the new hire's email names the business that is hiring them.
 * The invite/reminder email strings render with the company the hire is joining, in both
 * dictionaries; today only reminderBody has a {company} slot.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { HrNotices } from "./mod.ts";
import type { Hire } from "@hr/dto/hr.ts";
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
 * REQ-1157 (LOOP-007 q3, q3-89) — the signing link carries the language the message was written
 * in. sendLink writes the text and the email in the owner's language (users.language) but puts a
 * bare `/sign/<token>` in both, so /sign/[token] falls back to the pm_lang cookie, else Spanish.
 * The invite and the 24-hour reminder must both link `/sign/<token>?lang=<owner's lang>`.
 */
function notices(language: Lang) {
  const sms: { to: string; body: string }[] = [];
  const mails: { to: string; htmlBody: string }[] = [];
  const n = new HrNotices(
    {
      get: () => Promise.resolve({ language, name: "Maria", email: "m@x.com" }),
    } as never,
    {
      get: () => Promise.resolve({ businessName: "Reyes Lawn & Pool" }),
    } as never,
    { find: () => Promise.resolve(null) } as never,
    {} as never,
    {
      send: (
        i: { to: string; body: string },
      ) => (sms.push(i), Promise.resolve({ ok: true })),
    } as never,
    {
      send: (
        i: { to: string; htmlBody: string },
      ) => (mails.push(i), Promise.resolve({ ok: true })),
    } as never,
  );
  return { n, sms, mails };
}

const hire = {
  id: "h1",
  userId: "u1",
  token: "TOK123",
  firstName: "Rosa",
  lastName: "Diaz",
  phone: "+17025550142",
  email: "rosa@example.com",
} as unknown as Hire;

for (const lang of ["en", "es"] as Lang[]) {
  for (const kind of ["invite", "reminder"] as const) {
    Deno.test(
      `REQ-1157 (q3-89) sendLink ${kind} from a '${lang}' owner links /sign/<token>?lang=${lang} in the text and the email`,
      async () => {
        const { n, sms, mails } = notices(lang);
        await n.sendLink(hire, kind);
        assert(sms.length === 1 && mails.length === 1, "one text, one email");
        const want = `/sign/TOK123?lang=${lang}`;
        assertStringIncludes(sms[0].body, want, `SMS: ${sms[0].body}`);
        assertStringIncludes(
          mails[0].htmlBody,
          `${want}"`,
          `email: ${mails[0].htmlBody}`,
        );
      },
    );
  }
}
