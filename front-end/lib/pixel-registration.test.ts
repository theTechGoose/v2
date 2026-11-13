import { assertEquals } from "@std/assert";
import { registrationForRequest } from "./pixel-registration.ts";

/**
 * REQ-229 (demo issues test-setup-claims-pixel-staff-registration, demo-lifecycle-m4) — /welcome's
 * CompleteRegistration is decided from the session's own context (GET /admin/whoami, in process):
 * the account's own session counts; a super admin, an impersonation (the demo stage's frame) or a
 * whoami that fails does not.
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
  new Request("http://app/welcome", {
    headers: { cookie: "pm_session=sess_1" },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.test("REQ-229 registrationForRequest — the account's own session: CompleteRegistration keyed by the account, asked of /admin/whoami with the session", async () => {
  await withBackend(
    () =>
      json({
        authenticated: true,
        user: { id: "u_1" },
        superAdmin: false,
        impersonating: false,
        impersonator: null,
      }),
    async (seen) => {
      const ev = await registrationForRequest(page());
      assertEquals(ev, { name: "CompleteRegistration", eventId: "reg:u_1" });
      assertEquals(seen.length, 1);
      assertEquals(new URL(seen[0].url).pathname, "/admin/whoami");
      assertEquals(seen[0].headers.get("x-session-id"), "sess_1");
    },
  );
});

Deno.test("REQ-229 registrationForRequest — a staff login (super admin) is not a registration", async () => {
  await withBackend(
    () =>
      json({
        authenticated: true,
        user: { id: "staff" },
        superAdmin: true,
        impersonating: false,
      }),
    async () => assertEquals(await registrationForRequest(page()), null),
  );
});

Deno.test("REQ-229 registrationForRequest — an impersonation (the demo stage's frame) is not the customer's registration", async () => {
  await withBackend(
    () =>
      json({
        authenticated: true,
        user: { id: "cust" },
        superAdmin: false,
        impersonating: true,
        impersonator: { id: "staff" },
      }),
    async () => assertEquals(await registrationForRequest(page()), null),
  );
});

Deno.test("REQ-229 registrationForRequest — fails closed: whoami errors, or no session cookie", async () => {
  await withBackend(
    () => json({ name: "Boom" }, 500),
    async () => assertEquals(await registrationForRequest(page()), null),
  );
  await withBackend(
    () => {
      throw new Error("down");
    },
    async () => assertEquals(await registrationForRequest(page()), null),
  );
  await withBackend(
    () => json({ authenticated: true, user: { id: "x" } }),
    async (seen) => {
      assertEquals(
        await registrationForRequest(new Request("http://app/welcome")),
        null,
      );
      assertEquals(seen.length, 0, "no session, no backend call");
    },
  );
});
