/**
 * REQ-674 (demo-loop cycle 5, issue p18-4a "Assistant subtitle changes on
 * the same page") — /assistant and /assistant/<id> show ONE greeting, one
 * date line and one "new conversation" header.
 *
 * The first message on /assistant moves the same screen to /assistant/<id>.
 * Before the fix each route read its own key set (assistantPage.* vs
 * assistantThread.*), and the es values differed: "¿En qué te puedo ayudar?"
 * became "¿Qué puedo quitarte de encima?", "siempre disponible" became
 * "siempre activo", and "Conversación nueva" became "Nueva conversación"
 * (which is also what the chat island's own header key says once it takes
 * over — asstChat.header.newConversation, via shared/quote-flow/chat-header).
 *
 * The test reads the keys each route actually passes to DashTopbar and
 * ChatHeaderLive, then resolves them through the real dictionaries.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dict = (lang: "en" | "es"): Record<string, string> =>
  JSON.parse(read(`lang/${lang}.json`));

const ROUTES = {
  index: read("front-end/routes/assistant/index.tsx"),
  thread: read("front-end/routes/assistant/[threadId].tsx"),
};

function one(src: string, re: RegExp, what: string): string {
  const m = src.match(re);
  if (!m) throw new Error(`${what}: not found`);
  return m[1];
}

const greetingKey = (src: string) =>
  one(src, /greetingOverrideKey="([^"]+)"/, "greetingOverrideKey");
const dateKey = (src: string) =>
  one(src, /greetingDate=\{tFor\(lang, "([^"]+)"\)\}/, "greetingDate");
// /assistant: initialClient={tFor(lang, "<key>")}
// /assistant/<id>: the header fallback when the thread has no name yet
const newConversationKey = (src: string) =>
  src.includes('initialClient={tFor(lang, "')
    ? one(src, /initialClient=\{tFor\(lang, "([^"]+)"\)\}/, "initialClient")
    : one(src, /ssrHeader\?\.clientKey \?\? "([^"]+)"/, "header fallback");

describe("REQ-674 one assistant greeting across /assistant and /assistant/<id> (cycle 5, p18-4a)", () => {
  for (const lang of ["en", "es"] as const) {
    const d = dict(lang);

    test(`${lang}: the topbar greeting does not change after the first message`, () => {
      const a = d[greetingKey(ROUTES.index)];
      const b = d[greetingKey(ROUTES.thread)];
      expect(a).toBeTruthy();
      expect(b).toBe(a);
    });

    test(`${lang}: the topbar date line does not change`, () => {
      const a = d[dateKey(ROUTES.index)];
      const b = d[dateKey(ROUTES.thread)];
      expect(a).toBeTruthy();
      expect(b).toBe(a);
    });

    test(`${lang}: "new conversation" reads the same on both routes and in the chat island`, () => {
      const island = d["asstChat.header.newConversation"];
      expect(island).toBeTruthy();
      expect(d[newConversationKey(ROUTES.index)]).toBe(island);
      expect(d[newConversationKey(ROUTES.thread)]).toBe(island);
    });
  }

  test("no second, drifting copy of the greeting keys is left in the dictionaries", () => {
    for (const lang of ["en", "es"] as const) {
      const keys = Object.keys(dict(lang));
      expect(
        keys.filter((k) =>
          /^assistantThread\.(greetingOverride|greetingDate|newConversation)$/
            .test(k)
        ),
      ).toEqual([]);
    }
  });
});
