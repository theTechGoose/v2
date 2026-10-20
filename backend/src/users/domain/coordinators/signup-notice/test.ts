// REQ-103 — found in the gate: the served backend loads the primary's .env, so with its real
// Postmark key the two e2e runs mailed hello@documonster.com 70 times for the stories' fake
// sign-ups. On the fakes (REQ-318: DENO_DEPLOY unset, not on Deno Deploy) the notice is logged
// and counts as sent; Postmark is reached on the real deploy only. Pure stubs: no KV, no env.
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import type { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import { SignupNotice } from "./mod.ts";

const at = "2026-10-20T15:04:05.000Z";
const user = {
  id: "u-103",
  phoneNumber: "+15125550103",
  language: "es",
  name: "Nuevo usuario",
  createdAt: at,
  updatedAt: at,
};
const users = {
  get: (id: string) =>
    id === user.id
      ? Promise.resolve(user)
      : Promise.reject(new NotFoundError("user", id)),
} as unknown as UserStore;
const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

function capture(method: "log" | "warn") {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) =>
    lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console[method] = original) };
}

function notice(vars: Record<string, string>) {
  const sent: SendEmailInput[] = [];
  const n = new SignupNotice(users);
  n.env = env(vars);
  n.email = {
    send: (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, messageId: "m-1" });
    },
  };
  return { n, sent };
}

Deno.test("REQ-103 SignupNotice — on the fakes (neither switch set) the notice is logged with its subject, Postmark is never reached, and the record counts as sent", async () => {
  const { n, sent } = notice({});
  const logged = capture("log");
  try {
    await n.send("u-103");
  } finally {
    logged.restore();
  }
  assertEquals(sent, [], "no mail leaves the box");
  assertStringIncludes(
    logged.lines.at(-1) ?? "",
    "[signup-notice] fakes: would mail hello@documonster.com",
  );
  assertStringIncludes(
    logged.lines.at(-1) ?? "",
    "New DocuMonster signup — +15125550103",
  );
});

Deno.test("REQ-103 SignupNotice — on the real deploy (DENO_DEPLOY set, or Deno Deploy's DENO_DEPLOYMENT_ID) the account's email goes to hello@documonster.com through Postmark; a refusal is thrown for the sweep to retry", async () => {
  const real: Record<string, string>[] = [{ DENO_DEPLOY: "true" }, {
    DENO_DEPLOYMENT_ID: "abc123",
  }];
  for (const vars of real) {
    const { n, sent } = notice(vars);
    await n.send("u-103");
    assertEquals(sent.length, 1, JSON.stringify(vars));
    assertEquals(sent[0].to, "hello@documonster.com");
    assertEquals(sent[0].subject, "New DocuMonster signup — +15125550103");
  }
  const { n } = notice({ DENO_DEPLOY: "true" });
  n.email = {
    send: () => Promise.resolve({ ok: false, reason: "postmark 500: boom" }),
  };
  await assertRejects(
    () => n.send("u-103"),
    Error,
    "signup-notice: postmark 500: boom",
  );
});

Deno.test("REQ-103 SignupNotice — an account wiped before its sweep is nothing to tell: no mail, no throw, on either side of the switch", async () => {
  const sides: Record<string, string>[] = [{}, { DENO_DEPLOY: "true" }];
  for (const vars of sides) {
    const { n, sent } = notice(vars);
    const warned = capture("warn");
    try {
      await n.send("u-gone");
    } finally {
      warned.restore();
    }
    assertEquals(sent, []);
    assertStringIncludes(warned.lines.at(-1) ?? "", "u-gone");
  }
});
