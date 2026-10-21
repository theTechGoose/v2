/**
 * REQ-111 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Save incomplete signups. For
 * Monster Free, Monster, and Monster Assist, save any and all information collected, even if the
 * customer does not complete signup. Capture contact information as early as possible so we can
 * call and help them finish. Include their selected plan and the exact stage they reached so the
 * team knows how to follow up." Pure: the plan, the payment status and the stage an account is
 * at, read from what it has answered (the wizard's nine questions, REQ-091's one rule) — the words
 * the CRM customer and the signup notice carry.
 */
import { assertEquals } from "#std/assert";
import type { User } from "@users/dto/user.ts";
import type { UserPlan } from "@users/dto/plan.ts";
import { paymentStatus, planLabel, type SignupSnapshot, signupProgress } from "./mod.ts";

const at = "2026-10-21T15:00:00.000Z";
const user: User = { id: "u-111", phoneNumber: "+15125550111", language: "es", name: "Nuevo usuario", createdAt: at, updatedAt: at };
const plan = (planId: UserPlan["planId"], status: UserPlan["status"]): UserPlan => ({ userId: user.id, planId, status, chosenAt: at, updatedAt: at });
const snap = (over: Partial<SignupSnapshot> = {}): SignupSnapshot => ({ user, identity: null, address: null, insurance: null, plan: null, ...over });

Deno.test("REQ-111 planLabel + paymentStatus — the plan by its name, and where its payment stands: none, free, awaiting payment, paid, past due", () => {
  assertEquals([planLabel(null), paymentStatus(null)], ["", "none"]);
  assertEquals([planLabel(plan("free", "free")), paymentStatus(plan("free", "free"))], ["Monster Free", "free"]);
  assertEquals([planLabel(plan("monster", "pending")), paymentStatus(plan("monster", "pending"))], ["Monster", "awaiting payment"]);
  assertEquals([planLabel(plan("assist", "active")), paymentStatus(plan("assist", "active"))], ["Monster Assist", "paid"]);
  assertEquals([planLabel(plan("monster", "past_due")), paymentStatus(plan("monster", "past_due"))], ["Monster", "past due"]);
});

Deno.test("REQ-111 signupProgress — a fresh sign-up has answered nothing: the stage names the first question; the placeholder name is not a name", () => {
  const p = signupProgress(snap());
  assertEquals([p.answered, p.total, p.next, p.plan, p.payment], [0, 9, "name", "", "none"]);
  assertEquals(p.stage, "signed up — nothing answered yet, next the name");
});

Deno.test("REQ-111 signupProgress — the stage counts what onboarding has answered, in the wizard's order, and names what comes next", () => {
  const named = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test" }, identity: { userId: user.id, businessName: "Ana Roofing", createdAt: at, updatedAt: at } }));
  assertEquals([named.answered, named.next], [3, "plan"]);
  assertEquals(named.stage, "3 of 9 answered — next the plan");
  // a Monster Free signup never meets the plan question: free is on record, the state is next
  const free = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test" }, identity: { userId: user.id, businessName: "Ana Roofing", createdAt: at, updatedAt: at }, plan: plan("free", "free") }));
  assertEquals([free.answered, free.next, free.plan, free.payment], [4, "state", "Monster Free", "free"]);
  assertEquals(free.stage, "4 of 9 answered — next the state");
});

Deno.test("REQ-111 signupProgress — a paid pick waiting on its pay page is the stage the team cares about most: the plan, awaiting payment, is on the line", () => {
  const p = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test" }, identity: { userId: user.id, businessName: "Ana Roofing", createdAt: at, updatedAt: at }, plan: plan("monster", "pending") }));
  assertEquals([p.answered, p.next, p.plan, p.payment], [3, "plan", "Monster", "awaiting payment"]);
  assertEquals(p.stage, "3 of 9 answered — next the plan · Monster picked, awaiting payment");
});

Deno.test("REQ-111 signupProgress — every question answered is onboarding complete; Skip setup for now is said as such, with what is still open", () => {
  const identity = { userId: user.id, businessName: "Ana Roofing", logoFileId: "f-1", acceptedPaymentMethods: { cash: { enabled: true } }, createdAt: at, updatedAt: at };
  const address = { userId: user.id, state: "TX", street: "1600 Congress Ave", createdAt: at, updatedAt: at };
  const insurance = { userId: user.id, provider: "State Farm", createdAt: at, updatedAt: at };
  const done = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test", onboardedAt: at }, identity, address, insurance, plan: plan("assist", "active") }));
  assertEquals([done.answered, done.next, done.payment], [9, null, "paid"]);
  assertEquals(done.stage, "onboarding complete");
  const skipped = signupProgress(snap({ user: { ...user, name: "Ana", onboardedAt: at, onboardingSkipped: true }, identity: { userId: user.id, businessName: "Ana Roofing", createdAt: at, updatedAt: at } }));
  assertEquals(skipped.answered, 2);
  assertEquals(skipped.stage, "setup skipped — 2 of 9 answered, next the email");
});

Deno.test("REQ-113 signupProgress — the paid plan a sign-up named is the plan from the code on, before the pick: the plan question still open, payment none; the pick, once made, reads as it stands; a pick on record wins over the name", () => {
  const named = signupProgress(snap({ user: { ...user, signupPlan: "monster" } }));
  assertEquals([named.plan, named.payment, named.answered, named.next], ["Monster", "none", 0, "name"]);
  assertEquals(named.stage, "signed up — nothing answered yet, next the name");
  const assist = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test", signupPlan: "assist" }, identity: { userId: user.id, businessName: "Ana Roofing", createdAt: at, updatedAt: at } }));
  assertEquals([assist.plan, assist.payment, assist.next], ["Monster Assist", "none", "plan"]);
  assertEquals(assist.stage, "3 of 9 answered — next the plan");
  // the pick the email made: pending on its page
  const picked = signupProgress(snap({ user: { ...user, name: "Ana", email: "ana@roof.test", signupPlan: "monster" }, plan: plan("monster", "pending") }));
  assertEquals([picked.plan, picked.payment], ["Monster", "awaiting payment"]);
  assertEquals(picked.stage, "2 of 9 answered — next the business name · Monster picked, awaiting payment");
  // a pick on record wins: Monster Free picked after a $199 name
  const free = signupProgress(snap({ user: { ...user, signupPlan: "assist" }, plan: plan("free", "free") }));
  assertEquals([free.plan, free.payment], ["Monster Free", "free"]);
});
