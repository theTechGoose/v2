import { assert, assertEquals } from "@std/assert";

/**
 * REQ-1153 (LOOP-007 cycle 3, q3-82) — unit: the two pure choices behind "a logged-out deep link
 * goes to /login and, after the code, back to the page asked for".
 *
 *  - `loginRedirect(url)` is what every authed `_middleware.ts` answers when there is no session:
 *    a 302 to `/login?next=<path+search, encoded>` — never the bare `/` (the marketing home) the
 *    original scaffold sends, and never a `next` that leaves the site.
 *  - `afterCodeTarget(redirectTo, next)` is where CodeInput sends the tab after a good code: the
 *    page asked for when the backend's answer is the plain dashboard landing
 *    (`/dashboard?welcome=back`), but the REQ-091 onboarding wizard (`/welcome`) still wins, and an
 *    unsafe `next` is ignored.
 *
 * The module is new (front-end/lib/login-redirect.ts); it is loaded dynamically so a missing file
 * reads as the failed expectation it is, not a type-check error.
 */
type Mod = {
  loginRedirect: (url: URL) => Response;
  afterCodeTarget: (
    redirectTo: string,
    next: string | null | undefined,
  ) => string;
};

async function load(): Promise<Mod> {
  const path = "./login-redirect.ts";
  try {
    return (await import(path)) as Mod;
  } catch (e) {
    throw new Error(
      `REQ-1153: front-end/lib/login-redirect.ts (loginRedirect + afterCodeTarget) does not exist yet — ` +
        `every authed _middleware.ts still answers a bare 302 to "/" (${
          (e as Error).message.split("\n")[0]
        })`,
    );
  }
}

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): loginRedirect sends /quotes?open=abc to /login?next=%2Fquotes%3Fopen%3Dabc (302), not /", async () => {
  const { loginRedirect } = await load();
  const res = loginRedirect(new URL("http://app/quotes?open=abc"));
  assertEquals(res.status, 302);
  assertEquals(
    res.headers.get("location"),
    "/login?next=%2Fquotes%3Fopen%3Dabc",
  );
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): loginRedirect encodes the path alone for /dashboard and keeps every query param", async () => {
  const { loginRedirect } = await load();
  assertEquals(
    loginRedirect(new URL("http://app/dashboard")).headers.get("location"),
    "/login?next=%2Fdashboard",
  );
  assertEquals(
    loginRedirect(new URL("http://app/invoices/inv_1?tab=pay&lang=es")).headers
      .get("location"),
    "/login?next=" + encodeURIComponent("/invoices/inv_1?tab=pay&lang=es"),
  );
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): loginRedirect never carries a next that would leave the site ('//' or a backslash)", async () => {
  const { loginRedirect } = await load();
  for (const raw of ["http://app//evil.com/x", "http://app/%5C%5Cevil.com"]) {
    const loc = loginRedirect(new URL(raw)).headers.get("location") ?? "";
    assert(loc.startsWith("/login"), `${raw}: still a sign-in page (${loc})`);
    const next = new URL(loc, "http://app").searchParams.get("next");
    assert(
      next === null ||
        (next.startsWith("/") && !next.startsWith("//") &&
          !next.includes("\\")),
      `${raw}: next must be a site path, got ${JSON.stringify(next)}`,
    );
  }
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): after the code, the plain dashboard landing gives way to the page asked for", async () => {
  const { afterCodeTarget } = await load();
  assertEquals(
    afterCodeTarget("/dashboard?welcome=back", "/quotes?open=abc"),
    "/quotes?open=abc",
  );
  assertEquals(afterCodeTarget("/dashboard", "/invoices"), "/invoices");
});

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): after the code, /welcome (REQ-091) beats next; no next or an unsafe next keeps the backend's landing", async () => {
  const { afterCodeTarget } = await load();
  assertEquals(afterCodeTarget("/welcome", "/quotes?open=abc"), "/welcome");
  assertEquals(
    afterCodeTarget("/dashboard?welcome=back", null),
    "/dashboard?welcome=back",
  );
  assertEquals(
    afterCodeTarget("/dashboard?welcome=back", undefined),
    "/dashboard?welcome=back",
  );
  for (
    const bad of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "/login",
      "/verify?phone=1",
    ]
  ) {
    assertEquals(
      afterCodeTarget("/dashboard?welcome=back", bad),
      "/dashboard?welcome=back",
      bad,
    );
  }
});
