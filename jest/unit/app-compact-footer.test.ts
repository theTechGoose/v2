/**
 * REQ-425 — demo-loop cycle 2, issues p6 + p13-b ("fix every issue the demo
 * found, loop until there are none").
 *  - p6: the signed-in app routes end with a one-line compact SiteFooter
 *    (`<SiteFooter lang={lang} compact />`); the public pages keep the full one.
 *  - p13-b: AsstChat does not pin the empty (welcome) chat to the bottom.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const APP_ROUTES = [
  "assistant/index",
  "assistant/[threadId]",
  "dashboard/index",
  "clients/index",
  "invoices/index",
  "payments/index",
  "quotes/index",
  "settings/index",
  "work-orders/index",
  "field/assignments",
  "field/batches",
  "field/subscriptions",
  "field/tasks",
  "field/workers",
  "admin/index",
  "admins/index",
  "accounts-manager/index",
];
const PUBLIC_ROUTES = [
  "_error",
  "contact",
  "login",
  "login-internal",
  "verify",
  "verify-internal",
  "welcome",
  "pay/fake",
  "plan/test",
  "q/[id]",
  "i/[id]",
  "wo/[id]",
  "co/[id]",
];

describe("REQ-425 p6 the app's footer is one compact line", () => {
  it("REQ-425 every signed-in app route renders the compact footer", () => {
    for (const r of APP_ROUTES) {
      expect([r, read(`front-end/routes/${r}.tsx`)]).toEqual([
        r,
        expect.stringMatching(/<SiteFooter lang=\{lang\} compact \/>/),
      ]);
    }
  });

  it("REQ-425 the public pages keep the full footer", () => {
    for (const r of PUBLIC_ROUTES) {
      expect([r, read(`front-end/routes/${r}.tsx`)]).toEqual([
        r,
        expect.not.stringMatching(/<SiteFooter[^>]*compact/),
      ]);
    }
  });

  it("REQ-425 the compact prop travels SiteFooter → SiteFooterLive → SiteFooterView, which paints one wrapping row with the links, the phone and the address", () => {
    const wrapper = read("front-end/components/SiteFooter.tsx");
    expect(wrapper).toMatch(/compact\?: boolean/);
    expect(wrapper).toMatch(/compact=\{compact\}/);
    const live = read("front-end/islands/SiteFooterLive.tsx");
    expect(live).toMatch(/compact=\{compact\}/);
    const view = read("front-end/components/SiteFooterView.tsx");
    expect(view).toMatch(/data-site-footer-compact/);
    expect(view).toMatch(/flex-direction:row/);
    const compact = view.slice(view.indexOf("function CompactFooter"));
    expect(compact).toMatch(/copy\.links\.map/);
    expect(compact).toMatch(/data-site-phone/);
    expect(compact).toMatch(/data-site-address/);
  });
});

describe("REQ-425 p13-b the empty chat is not pinned to the bottom", () => {
  it("REQ-425 AsstChat's mount pin, resize pin and message-count scroll go to the top while the welcome state shows", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/const welcomeRef = useRef/);
    expect(src).toMatch(/welcomeRef\.current = empty && !panelOpen;/);
    const pinEffect = src.slice(
      // REQ-469: the pin itself lives in lib/chat-bottom-pin.ts now
      src.indexOf("return attachBottomPin("),
      src.indexOf("}, [messages.length]);"),
    );
    // no unconditional bottom pin is left in the auto-scroll effects
    expect(pinEffect).not.toMatch(/scrollTop = scroller\.scrollHeight;/);
    expect(pinEffect).not.toMatch(/top: el\.scrollHeight/);
    expect(pinEffect).toMatch(/welcomeRef\.current/);
    const pin = read("front-end/lib/chat-bottom-pin.ts");
    expect(pin).toMatch(
      /scrollTop = deps\.isWelcome\(\) \? 0 : scroller\.scrollHeight;/,
    );
    expect(pin).toMatch(
      /if \(deps\.isWelcome\(\)\) \{\s*wasWelcome = true;\s*return;/,
    );
  });
});
