/**
 * REQ-631 — "Language is per person." While an invited editor acts in the owner's account, the
 * UI language is HERS: every SSR route, the dashboard seed (which writes pm_lang + localStorage),
 * the sidebar and Settings read the signed-in person's language through one helper — the actor's
 * while acting, else the account's. The toggle's PUT /me lands on her record (backend), and the
 * Settings language row shows hers.
 */
import * as fs from "fs";
import * as path from "path";
import { personLanguage } from "../../shared/person-name/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-631 personLanguage — the person's language over the account's", () => {
  test("acting: the editor's language, never the owner's", () => {
    expect(personLanguage({ language: "en", actor: { language: "es" } })).toBe("es");
    expect(personLanguage({ language: "es", actor: { language: "en" } })).toBe("en");
  });
  test("acting with no language of her own yet: the account's", () => {
    expect(personLanguage({ language: "en", actor: {} })).toBe("en");
  });
  test("own session: the user's", () => {
    expect(personLanguage({ language: "es" })).toBe("es");
    expect(personLanguage({ language: "en", actor: null })).toBe("en");
  });
  test("the actor can ride separately (the /profile snapshot carries it next to the user)", () => {
    expect(personLanguage({ language: "en" }, { language: "es" })).toBe("es");
  });
  test("nothing valid: undefined, so each caller keeps its own default", () => {
    expect(personLanguage(undefined)).toBeUndefined();
    expect(personLanguage({ language: "fr" as never })).toBeUndefined();
  });
});

/** source minus comment lines, so a doc mention of `user.language` is not a read */
const code = (rel: string) =>
  read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("REQ-631 every UI-language read goes through the helper", () => {
  const routes = [
    "routes/dashboard/index.tsx",
    "routes/assistant/index.tsx",
    "routes/assistant/[threadId].tsx",
    "routes/work-orders/index.tsx",
    "routes/invoices/index.tsx",
    "routes/quotes/index.tsx",
    "routes/clients/index.tsx",
    "routes/payments/index.tsx",
    "routes/settings/index.tsx",
    "routes/admins/index.tsx",
    "routes/admin/index.tsx",
    "routes/accounts-manager/index.tsx",
    "routes/wo/[id].tsx",
    "routes/field/tasks.tsx",
    "routes/field/assignments.tsx",
    "routes/field/workers.tsx",
    "routes/field/batches.tsx",
    "routes/field/subscriptions.tsx",
    "routes/welcome.tsx",
    "routes/demo/stage.tsx",
    "routes/plan/pay.tsx",
    "routes/plan/test.tsx",
  ];
  // REQ-631 AMENDMENT — reconciled with develop on demo-fixes: demo-fixes'
  // REQ-709 routes resolve their language through ONE resolver,
  // resolveSsrLang (?lang= > the person > pm_lang), which reads personLanguage.
  test("the routes' one resolver, resolveSsrLang, reads the person's language", () => {
    expect(code("front-end/lib/ssr-lang.ts")).toMatch(/personLanguage\(src\.state\?\.user\)/);
  });
  test.each(routes)("%s renders in the person's language (personLanguage), not the account's user.language", (rel) => {
    const src = code(`front-end/${rel}`);
    expect(src).toMatch(/personLanguage\(|resolveSsrLang\(|presenterLangForRequest\(/);
    expect(src).not.toMatch(/\buser\??\.language\b/);
  });

  test("no island, component or lib reads the account's user.language for the UI", () => {
    const dirs = ["islands", "components", "lib", "routes"];
    const offenders: string[] = [];
    const walk = (rel: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, "front-end", rel), { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(r);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (/\buser\??\.language\b/.test(code(`front-end/${r}`))) offenders.push(r);
        }
      }
    };
    for (const d of dirs) walk(d);
    expect(offenders).toEqual([]);
  });

  test("the dashboard seed (setLang → pm_lang + localStorage) uses the person's language", () => {
    const src = read("front-end/lib/dash-cache.ts");
    expect(src).toMatch(/personLanguage\(snap\.profile\?\.user, snap\.profile\?\.actor\)/);
  });

  test("the sidebar and Settings read the person's language; Settings' language row shows hers", () => {
    // REQ-631 AMENDMENT — reconciled with develop on demo-fixes: the sidebar
    // (REQ-712) and Settings (REQ-254) render in langSignal, the one live
    // switch, which the dashboard cache seeds from personLanguage (above);
    // the sidebar names the person (her name) through sidebarIdentity's actor.
    expect(read("front-end/islands/DashSidebar.tsx")).toMatch(/langSignal\.value/);
    expect(read("front-end/lib/greeting-identity.ts")).toMatch(/personName\(/);
    const s = read("front-end/islands/SettingsPage.tsx");
    expect(s).toMatch(/const lang: Lang = langSignal\.value === "es" \? "es" : "en";/);
    expect(s).toMatch(/\[t\.language, lang === "es" \? t\.spanish : t\.english\]/);
  });

  test("the /me and /profile types carry the actor's language", () => {
    expect(read("front-end/lib/auth.ts")).toMatch(/actor\?:\s*\{[^}]*language\?: "en" \| "es"/);
    expect(read("front-end/clients/profile.ts")).toMatch(/interface ActorView[\s\S]{0,500}language\?: "en" \| "es"/);
  });
});

describe("REQ-631 the app's own words to the person follow HER language (backend)", () => {
  const be = (rel: string) => read(`backend/src/${rel}`);
  test("the shared rule is the one the backend uses", () => {
    expect(be("users/domain/coordinators/require-user/mod.ts")).toMatch(/export function uiLangOf\([\s\S]{0,200}personLanguage\(r\.user, r\.actor\)/);
  });
  test.each([
    "communication/entrypoints/notification-controller/mod.ts",
    "analytics/entrypoints/quotes-controller/mod.ts",
    // REQ-631 AMENDMENT: clients-controller left out — demo-fixes' REQ-367
    // made its cards language-free data, worded by the client in its language
    "agents/entrypoints/conversations-controller/mod.ts",
    "agents/entrypoints/chat-controller/mod.ts",
  ])("%s reads uiLangOf(the session)", (rel) => {
    expect(be(rel)).toMatch(/uiLangOf\(signedIn\)/);
  });
  test("the assistant's server-authored replies take the person's language over the account record", () => {
    const h = be("agents/domain/coordinators/handle-chat-message/mod.ts");
    expect(h).toMatch(/uiLang\?: "en" \| "es"/);
    // REQ-631 AMENDMENT — reconciled with develop on demo-fixes: the language
    // the message was typed in (REQ-438) first, then the person's, then the account's
    expect(h).toMatch(/messageLang\(input\.content\)[\s\S]{0,200}input\.uiLang \?\?/);
    expect(be("agents/entrypoints/chat-controller/mod.ts")).toMatch(/uiLang: uiLangOf\(signedIn\)/);
  });
  test("PUT /me while acting writes the language to her record, nothing to the account", () => {
    const b = be("users/domain/business/account-admins/mod.ts");
    expect(b).toMatch(/if \(patch\.language !== undefined\) actor\.language = patch\.language;/);
    expect(b).not.toMatch(/account\.language = /);
  });
  test("customer-facing sends stay on the business: the paperwork email/SMS resolve commsLanguage, never the session", () => {
    for (const rel of [
      "paperwork/domain/coordinators/send-paperwork-email/mod.ts",
      "paperwork/domain/coordinators/send-paperwork-sms/mod.ts",
    ]) {
      const s = be(rel);
      expect(s).toMatch(/commsLanguage/);
      expect(s).not.toMatch(/uiLangOf|personLanguage/);
    }
  });
});
