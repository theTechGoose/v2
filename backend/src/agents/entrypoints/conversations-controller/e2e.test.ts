import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9070;

async function drain(res: Response) { await res.body?.cancel(); }

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("agents conversations e2e: POST creates a fresh conversation in 'quote' phase", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    assertEquals(conv.currentPhase, "quote");
    assertEquals(typeof conv.id, "string");
  });
});

Deno.test("agents conversations e2e: GET list returns newest-first scoped to caller", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const a = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 5));
    const b = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const list = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.length, 2);
    assertEquals(list[0].id, b.id);
    assertEquals(list[1].id, a.id);
  });
});

Deno.test("agents conversations e2e: GET list does not leak across users", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sidA }, body: "{}",
    }).then(drain);
    const bList = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sidB },
    }).then((r) => r.json());
    assertEquals(bList, []);
  });
});

Deno.test("agents conversations e2e: GET /:id returns conversation + empty messages for fresh conv", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    const snap = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(snap.conversation.id, conv.id);
    assertEquals(snap.messages, []);
    assertEquals(snap.wizard, undefined);
  });
});

Deno.test("agents conversations e2e: POST /sample-quote is idempotent (same quote on repeat)", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const first = await fetch(`http://localhost:${port}/agents/conversations/sample-quote`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    assertEquals(first.created, true);
    const second = await fetch(`http://localhost:${port}/agents/conversations/sample-quote`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    assertEquals(second.created, false);
    assertEquals(second.quoteId, first.quoteId);
  });
});

Deno.test("agents conversations e2e: onboarding-start handoff seeds the invitation + example", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const start = await fetch(`http://localhost:${port}/agents/conversations/onboarding-start`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ handoff: true, examplePrompt: "Paver patio for the Nguyens — $3,700" }),
    }).then((r) => r.json());
    assertEquals(start.seeded, true);

    const snap = await fetch(`http://localhost:${port}/agents/conversations/${start.conversationId}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(snap.messages.length, 1);
    assertEquals(snap.messages[0].role, "assistant");
    const content = snap.messages[0].content as string;
    // Contains the hand-off invitation AND the chosen example. Fresh users are
    // Spanish-first, so the invitation is the Spanish "primera cotización".
    if (!content.includes("primera cotización")) {
      throw new Error(`handoff invitation missing: ${content}`);
    }
    if (!content.includes("Paver patio for the Nguyens")) {
      throw new Error(`example prompt missing: ${content}`);
    }
  });
});

Deno.test("agents conversations e2e: POST /:id/transition-to-terms flips phase + appends divider + wizard", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const result = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(result.conversation.currentPhase, "terms");
    assertEquals(result.newMessages.length, 2);
    assertEquals(result.newMessages[0].kind, "phase_divider");
    assertEquals(result.newMessages[1].kind, "wizard");
  });
});

Deno.test("agents conversations e2e: DELETE removes the conversation", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());
    const del = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      method: "DELETE", headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(del, { ok: true });

    const after = await fetch(`http://localhost:${port}/agents/conversations`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after, []);
  });
});

Deno.test("agents conversations e2e: GET /:id/phase returns the projected phase state", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
    }).then((r) => r.json());

    const fresh = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/phase`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(fresh.currentPhase, "quote");
    assertEquals(fresh.canAdvance, false);
    assertEquals(fresh.nextPhaseHint, "terms");
    assertEquals(fresh.quoteId, undefined);

    await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/transition-to-terms`, {
      method: "POST", headers: { "x-session-id": sid },
    }).then(drain);

    const after = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/phase`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after.currentPhase, "terms");
    assertEquals(after.canAdvance, false);
    assertEquals(after.nextPhaseHint, undefined);
  });
});

Deno.test("agents conversations e2e: GET without session is rejected", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://localhost:${port}/agents/conversations`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  });
});

// ── REQ-230 (demo issue M14) ────────────────────────────────────────────
// The assistant's pre-Continue flow (job options, the pick, the price, the
// view) is saved ON the conversation, so a GET from any window rebuilds it.
// Before: POST /draft took only {note, quoteId}; GET returned one user
// message while the contractor sat on the options or the price.

const PRE_CONTINUE_DRAFT = {
  flowChip: "helpPrice",
  suggestPricing: true,
  invoiceFlow: false,
  awaitingJobDetails: false,
  jobDetailsRaw: "Patio slab 10x12 for the Nguyen family",
  submittedJobDetails: "Patio slab 10x12 for the Nguyen family",
  jobOptionsOpen: false,
  pickerMode: "polish",
  jobOptions: [{
    id: "opt-1",
    jobName: "Patio Slab",
    summary: "Pour a 10x12 concrete patio slab",
    bullets: [{ id: "b1", text: "Excavate and grade", deleted: false }],
  }],
  optionsDegraded: false,
  selectedOptionId: "opt-1",
  confirmedOption: {
    id: "opt-1",
    jobName: "Patio Slab",
    summary: "Pour a 10x12 concrete patio slab",
    bullets: [{ id: "b1", text: "Excavate and grade", deleted: false }],
  },
  priceCaptureOpen: true,
  priceCents: 370000,
  priceSuggestions: null,
  priceBasis: null,
  previewCtaId: null,
  polishRaw: null,
};

async function newConv(port: number, sid: string): Promise<{ id: string }> {
  return await fetch(`http://localhost:${port}/agents/conversations`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-id": sid }, body: "{}",
  }).then((r) => r.json());
}

function postDraft(port: number, sid: string, id: string, body: unknown) {
  return fetch(`http://localhost:${port}/agents/conversations/${id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  });
}

Deno.test("REQ-230 (M14): POST /:id/draft {draft} is saved on the conversation; GET /:id from another window returns it", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await newConv(port, sid);
    await drain(await postDraft(port, sid, conv.id, {
      note: PRE_CONTINUE_DRAFT.jobDetailsRaw,
      draft: PRE_CONTINUE_DRAFT,
    }));
    // A second sign-in of the same account = another window (the demo
    // stage impersonates the customer): it has no sessionStorage, only GET.
    const sid2 = await login(port);
    const detail = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sid2 },
    }).then((r) => r.json());
    assertEquals(detail.messages.length, 1, "the note is still the one user message");
    assertEquals(detail.draft, PRE_CONTINUE_DRAFT);
  });
});

Deno.test("REQ-230 (M14): a later draft replaces the earlier; draft:null clears it; garbage is ignored", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await newConv(port, sid);
    await drain(await postDraft(port, sid, conv.id, { draft: { ...PRE_CONTINUE_DRAFT, priceCaptureOpen: false, jobOptionsOpen: true } }));
    await drain(await postDraft(port, sid, conv.id, { draft: PRE_CONTINUE_DRAFT }));
    const get = () =>
      fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
        headers: { "x-session-id": sid },
      }).then((r) => r.json());
    assertEquals((await get()).draft.priceCaptureOpen, true);
    await drain(await postDraft(port, sid, conv.id, { draft: "not a draft" }));
    assertEquals((await get()).draft.priceCents, 370000, "garbage does not wipe the draft");
    await drain(await postDraft(port, sid, conv.id, { draft: null }));
    assertEquals((await get()).draft, undefined);
  });
});

Deno.test("REQ-230 (M14): binding the quote keeps the draft (the pick and the price survive Continue)", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const conv = await newConv(port, sid);
    await drain(await postDraft(port, sid, conv.id, { draft: PRE_CONTINUE_DRAFT }));
    await drain(await postDraft(port, sid, conv.id, { quoteId: "q-123" }));
    const detail = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(detail.conversation.quoteId, "q-123");
    assertEquals(detail.draft.confirmedOption.id, "opt-1");
    assertEquals(detail.draft.priceCents, 370000);
  });
});

Deno.test("REQ-230 (M14): another account cannot write or read the draft; DELETE removes it", async () => {
  await withServer(async (port) => {
    const sidA = await login(port, "+15125551234");
    const sidB = await login(port, "+15125559999");
    const conv = await newConv(port, sidA);
    const res = await postDraft(port, sidB, conv.id, { draft: PRE_CONTINUE_DRAFT });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false, "a stranger's draft write is refused");
    const own = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sidA },
    }).then((r) => r.json());
    assertEquals(own.draft, undefined);

    await drain(await postDraft(port, sidA, conv.id, { draft: PRE_CONTINUE_DRAFT }));
    await fetch(`http://localhost:${port}/agents/conversations/${conv.id}`, {
      method: "DELETE", headers: { "x-session-id": sidA },
    }).then(drain);
    const { AgentConversationStore } = await import("@agents/domain/data/agent-conversation-store/mod.ts");
    assertEquals(await new AgentConversationStore().getDraft(conv.id), null);
  });
});

Deno.test("agents conversations e2e: REQ-234 (demo M3) POST /:id/lock-quote locks the quote but does NOT send it", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const h = { "content-type": "application/json", "x-session-id": sid };
    const customer = await fetch(`http://localhost:${port}/customers`, {
      method: "POST", headers: h,
      body: JSON.stringify({ name: "Acme", email: "ops@acme.test" }),
    }).then((r) => r.json());
    const quote = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: h,
      body: JSON.stringify({
        summary: "Roof",
        customerId: customer.id,
        lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 10000 }],
        estimatedTotal: 10000,
      }),
    }).then((r) => r.json());
    const conv = await fetch(`http://localhost:${port}/agents/conversations`, {
      method: "POST", headers: h, body: "{}",
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${port}/agents/conversations/${conv.id}/lock-quote`, {
      method: "POST", headers: h, body: JSON.stringify({ quoteId: quote.id }),
    });
    assertEquals(res.status, 200);
    const result = await res.json();
    assertEquals(result.conversation.quoteStatus, "locked");
    assertEquals(result.newMessages[0].kind, "action_card");
    assertEquals(result.newMessages[0].payload.status, "locked");

    const after = await fetch(`http://localhost:${port}/quotes/${quote.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(after.status, "draft");
    assertEquals(after.sentAt, undefined);
    assertEquals(typeof after.lockedAt, "string");
  });
});
