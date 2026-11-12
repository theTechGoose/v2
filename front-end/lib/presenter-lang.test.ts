import { assertEquals } from "@std/assert";
import { presenterLang, presenterLangForRequest } from "./presenter-lang.ts";

/**
 * REQ-341 (demo-loop cycle 1, issue M10) — /demo/stage renders in the PRESENTER's language. Under
 * impersonation the request's resolved user (/me) is the customer, so the stage asks
 * GET /admin/whoami (in process) and takes `impersonator.language`; a plain session, a failed
 * whoami or a missing cookie fall back to the resolved user's language.
 */
type Fetch = (req: Request) => Response | Promise<Response>;
const g = globalThis as { __backendFetch?: Fetch };

async function withBackend<T>(
  answer: (req: Request) => Response,
  run: (seen: Request[]) => Promise<T>,
): Promise<T> {
  const seen: Request[] = [];
  const prev = g.__backendFetch;
  g.__backendFetch = (req) => {
    seen.push(req);
    return answer(req);
  };
  try {
    return await run(seen);
  } finally {
    g.__backendFetch = prev;
  }
}

const page = () =>
  new Request("http://app/demo/stage", {
    headers: { cookie: "pm_session=sess_1" },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const customerEs = { id: "cust", language: "es" as const };

Deno.test("REQ-341 presenterLang — the impersonator's language wins over the resolved (customer) user's", () => {
  assertEquals(
    presenterLang(
      {
        authenticated: true,
        impersonating: true,
        impersonator: { id: "staff", language: "en" },
      },
      customerEs,
    ),
    "en",
  );
  assertEquals(
    presenterLang(
      {
        authenticated: true,
        impersonating: true,
        impersonator: { id: "staff", language: "es" },
      },
      { id: "cust", language: "en" },
    ),
    "es",
  );
});

Deno.test("REQ-341 presenterLang — not impersonating, no whoami, or an impersonator without a language: the resolved user's (en by default)", () => {
  assertEquals(
    presenterLang({ authenticated: true, impersonating: false }, customerEs),
    "es",
  );
  assertEquals(presenterLang(undefined, customerEs), "es");
  assertEquals(
    presenterLang({
      authenticated: true,
      impersonating: true,
      impersonator: { id: "staff" },
    }, customerEs),
    "es",
  );
  assertEquals(presenterLang(undefined, undefined), "en");
  assertEquals(presenterLang(undefined, { id: "x" }), "en");
});

Deno.test("REQ-341 presenterLangForRequest — staff en impersonating a customer es: en, asked of /admin/whoami with the request's session", async () => {
  await withBackend(
    () =>
      json({
        authenticated: true,
        user: { id: "cust", language: "es" },
        superAdmin: false,
        impersonating: true,
        impersonator: { id: "staff", language: "en" },
      }),
    async (seen) => {
      assertEquals(await presenterLangForRequest(page(), customerEs), "en");
      assertEquals(seen.length, 1);
      assertEquals(new URL(seen[0].url).pathname, "/admin/whoami");
      assertEquals(seen[0].headers.get("x-session-id"), "sess_1");
    },
  );
});

Deno.test("REQ-341 presenterLangForRequest — a whoami that fails, a plain session, or no cookie: the resolved user's language", async () => {
  await withBackend(
    () => json({ name: "Boom" }, 500),
    async () =>
      assertEquals(await presenterLangForRequest(page(), customerEs), "es"),
  );
  await withBackend(
    () => {
      throw new Error("down");
    },
    async () =>
      assertEquals(await presenterLangForRequest(page(), customerEs), "es"),
  );
  await withBackend(
    () =>
      json({
        authenticated: true,
        user: { id: "cust", language: "es" },
        impersonating: false,
      }),
    async () =>
      assertEquals(await presenterLangForRequest(page(), customerEs), "es"),
  );
  await withBackend(
    () => json({ authenticated: true }),
    async (seen) => {
      assertEquals(
        await presenterLangForRequest(
          new Request("http://app/demo/stage"),
          customerEs,
        ),
        "es",
      );
      assertEquals(seen.length, 0, "no session, no backend call");
    },
  );
});
