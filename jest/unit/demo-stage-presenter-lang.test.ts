/**
 * REQ-341 — demo-loop cycle 1, issue M10: "Stage controls switch to the customer's language on a demo
 * started after the customer chose ES". REQ-270 seeded the stage from ctx.state.user.language, but on
 * /demo/stage that user is the impersonated CUSTOMER (/me resolves session.userId; the staff is only
 * session.impersonatorId). The stage must render in the PRESENTER's language.
 */
import * as fs from "fs";
import * as path from "path";
import { presenterLang } from "../../front-end/lib/presenter-lang";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-341 presenterLang picks the presenter, not the impersonated customer", () => {
  test("REQ-341 staff en impersonating a customer es → en", () => {
    expect(
      presenterLang(
        { authenticated: true, impersonating: true, impersonator: { id: "staff", language: "en" } },
        { id: "cust", language: "es" },
      ),
    ).toBe("en");
  });

  test("REQ-341 staff es impersonating a customer en → es", () => {
    expect(
      presenterLang(
        { authenticated: true, impersonating: true, impersonator: { id: "staff", language: "es" } },
        { id: "cust", language: "en" },
      ),
    ).toBe("es");
  });

  test("REQ-341 (amended by REQ-829) not impersonating / whoami failed → the resolved user's; impersonator without a language → en (not the customer's); nothing → en", () => {
    const es = { id: "cust", language: "es" as const };
    expect(presenterLang({ authenticated: true, impersonating: false }, es)).toBe("es");
    expect(presenterLang(undefined, es)).toBe("es");
    // REQ-829 (dm2, m7): never the impersonated customer's language — the pm_lang cookie, then en
    expect(presenterLang({ authenticated: true, impersonating: true, impersonator: { id: "s" } }, es)).toBe("en");
    expect(presenterLang(undefined, undefined)).toBe("en");
  });
});

describe("REQ-341 /demo/stage resolves its language through the presenter resolver", () => {
  const route = read("front-end/routes/demo/stage.tsx");

  test("REQ-341 (amended by REQ-812) the /demo middleware awaits presenterLangForRequest(ctx.req, user) into ctx.state.lang, which the route reads", () => {
    const mw = read("front-end/routes/demo/_middleware.ts");
    expect(mw).toMatch(/import \{[^}]*presenterLangForRequest[^}]*\} from "\.\.\/\.\.\/lib\/presenter-lang\.ts"/);
    expect(mw).toMatch(/ctx\.state\.lang = await presenterLangForRequest\(\s*ctx\.req,\s*user,?\s*\)/);
    expect(route).toMatch(/const lang(?:: Lang)? = ctx\.state\.lang\b/);
  });

  test("REQ-341 the route never reads ctx.state.user.language itself (that is the customer under impersonation)", () => {
    expect(route).not.toMatch(/ctx\.state\.user\??\.language/);
  });

  test("REQ-341 the title and the island share the presenter's lang", () => {
    // REQ-367 (reconciled on demo-fixes): the title is a DocTitle seeded with
    // the presenter's lang, carrying both languages for the live switch.
    expect(route).toMatch(
      /tFor\(lang, "demoMode\.title"\)|<DocTitle\s+lang=\{lang\}[\s\S]{0,120}tFor\(l, "demoMode\.title"\)/,
    );
    expect(route).toMatch(/<DemoStage\s+initialLang=\{lang\}\s*\/>/);
  });

  test("REQ-341 whoami's user views carry language (the backend projection and the client type)", () => {
    expect(read("backend/src/users/domain/business/admin-user-view/mod.ts")).toMatch(/language:\s*user\.language/);
    expect(read("front-end/clients/admin.ts")).toMatch(/interface AdminUserView \{[^}]*language\?:\s*"en" \| "es"/s);
  });
});
