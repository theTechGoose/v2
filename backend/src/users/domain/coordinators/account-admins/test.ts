/**
 * REQ-1061 (LOOP-007 cycle 2, q2-49) — amends REQ-146 / REQ-601: the editor
 * invite text and the /admins share block (`signInUrl`) point at the sign-in
 * page in the owner's language — `<appUrl>/login?lang=<owner's lang>` — not the
 * bare site root, which a signed-out invitee sees as the marketing page (in
 * whatever language her browser asks for), like the worker text's
 * `/worker?lang=…` deep link (REQ-285).
 *
 * The coordinator, with in-memory stand-ins for its stores and the SMS seam.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { AccountAdmins } from "./mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import type { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import type { SessionStore } from "@users/domain/data/session-store/mod.ts";
import type { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import type { SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import type { User } from "@users/dto/user.ts";

function coordinator() {
  const texts: SendSmsInput[] = [];
  const admins = {
    find: () => Promise.resolve(null),
    create: (r: { userId: string; phoneNumber: string; name: string }) =>
      Promise.resolve({ id: "adm-1", createdAt: "2026-11-19", ...r }),
  } as unknown as AccountAdminStore;
  const identities = {
    get: () => Promise.resolve({ businessName: "Ruiz Lawn & Pool Care" }),
  } as unknown as BusinessIdentityStore;
  const sms = {
    send: (input: SendSmsInput) => {
      texts.push(input);
      return Promise.resolve({ ok: true });
    },
  } as unknown as SmsService;
  const c = new AccountAdmins(
    admins,
    {} as SessionStore,
    {} as UserStore,
    identities,
    sms,
  );
  return { c, texts };
}

const owner = (language: "en" | "es"): User => ({
  id: "owner-1",
  phoneNumber: "+15125552400",
  name: "Dana Ruiz",
  language,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
});

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1061 (LOOP-007 q2-49) an ${lang} owner's editor invite links to /login?lang=${lang}, not the bare site root`, async () => {
    const { c, texts } = coordinator();
    const want = `${appUrl()}/login?lang=${lang}`;
    const made = await c.invite(owner(lang), {
      phoneNumber: "5125552401",
      name: "Carol Miller",
    });
    assertEquals(texts.length, 1, "one invite text");
    assert(
      texts[0].body.includes(want),
      `the invite text carries ${want} (got "${texts[0].body}")`,
    );
    assertEquals(
      made.signInUrl,
      want,
      "the /admins share block hands over the same sign-in link",
    );
    assertEquals(made.shareText, texts[0].body);
  });
}
