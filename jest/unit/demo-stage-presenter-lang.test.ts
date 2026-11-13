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

  test("REQ-341 not impersonating / whoami failed / impersonator without a language → the resolved user's; nothing → en", () => {
    const es = { id: "cust", language: "es" as const };
    expect(presenterLang({ authenticated: true, impersonating: false }, es)).toBe("es");
    expect(presenterLang(undefined, es)).toBe("es");
    expect(presenterLang({ authenticated: true, impersonating: true, impersonator: { id: "s" } }, es)).toBe("es");
    expect(presenterLang(undefined, undefined)).toBe("en");
  });
});

describe("REQ-341 /demo/stage resolves its language through the presenter resolver", () => {
  const route = read("front-end/routes/demo/stage.tsx");

  test("REQ-341 the route awaits presenterLangForRequest(ctx.req, ctx.state.user) into lang", () => {
    expect(route).toMatch(/import \{[^}]*presenterLangForRequest[^}]*\} from "\.\.\/\.\.\/lib\/presenter-lang\.ts"/);
    expect(route).toMatch(/const lang(?:: Lang)? = await presenterLangForRequest\(\s*ctx\.req,\s*ctx\.state\.user,?\s*\)/);
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
