/**
 * REQ-806 — the approve-link door. `ask` (anyone) → a text to the super-admin phone with a
 * one-time link → `decide` (the link's holder, by POST) → `poll` (the asker's token) hands the
 * read-only 30-minute view's session over once. Separate from sign-in and /admin.
 */
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RateLimiter } from "@core/data/rate-limit/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { OpsRequestStore } from "@users/domain/data/ops-request-store/mod.ts";
import { adminSearchMatches } from "@users/domain/business/admin-user-view/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { devCodeFor } from "@users/domain/business/dev-code/mod.ts";
import {
  approveText,
  hashToken,
  newToken,
  OPS_REQUEST_TTL_MS,
  OPS_REQUESTS_PER_HOUR,
  OPS_VIEW_TTL_MS,
  type OpsRequest,
  opsStatus,
} from "@users/domain/business/ops-access/mod.ts";

/** who approves: the always-super-admin phone (user-store's hardcoded one) */
export const OPS_APPROVER_PHONE = "+18438557133";

/** carries its HTTP status (Danet answers `error.status`) and its code as the message */
export class OpsError extends Error {
  constructor(readonly status: number, readonly error: string) {
    super(error);
    this.name = "OpsError";
  }
}

@Injectable()
export class OpsAccess {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private sms: SmsService,
    private limiter: RateLimiter,
    private identities: BusinessIdentityStore,
    private requests: OpsRequestStore,
  ) {}

  /** the one account `query` names (a phone, a name, an email, a business), or why not */
  private async match(query: string) {
    const hits: Array<{ id: string; label: string }> = [];
    for (const u of await this.users.searchByPhone("", 100_000)) {
      if (u.deletedAt) continue;
      const business = (await this.identities.get(u.id).catch(() => null))
        ?.businessName;
      if (adminSearchMatches(u, business, query)) {
        hits.push({
          id: u.id,
          label: `${business || u.name || "Account"} (${u.phoneNumber})`,
        });
        if (hits.length > 1) break;
      }
    }
    return hits;
  }

  async ask(input: { account: string; reason: string }) {
    const query = input.account.trim();
    if (!query) throw new OpsError(400, "account_required");
    const gate = await this.limiter.take(
      "ops-request",
      "all",
      OPS_REQUESTS_PER_HOUR,
      60 * 60_000,
    );
    if (!gate.allowed) throw new OpsError(429, "rate_limited");
    const pollToken = newToken(), approveToken = newToken();
    const now = Date.now();
    const hits = await this.match(query);
    const one = hits.length === 1 ? hits[0] : undefined;
    const r: OpsRequest = {
      id: crypto.randomUUID(),
      pollHash: await hashToken(pollToken),
      approveHash: await hashToken(approveToken),
      query,
      reason: input.reason.trim().slice(0, 200),
      status: one ? "pending" : "no_match",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OPS_REQUEST_TTL_MS).toISOString(),
      ...(one ? { targetUserId: one.id, targetLabel: one.label } : {}),
    };
    await this.requests.put(r);
    console.log(
      `[ops] ask ${r.id} query=${JSON.stringify(query)} → ${
        one ? one.id : `no single match (${hits.length})`
      }`,
    );
    if (one) {
      await this.sms.send({
        to: OPS_APPROVER_PHONE,
        body: approveText({
          account: one.label,
          reason: r.reason,
          url: `${appUrl()}/ops/approve/${approveToken}`,
        }),
      });
    }
    // on the fakes no text goes out, so the link's token rides the reply (REQ-082's rule); on
    // the real deploy it never does — only the super-admin phone gets it
    const dev = one ? devCodeFor(approveToken) : undefined;
    return {
      id: r.id,
      pollToken,
      expiresAt: r.expiresAt,
      ...(dev ? { devApproveToken: dev } : {}),
    };
  }

  private async byToken(token: string) {
    const r = await this.requests.byApproveHash(await hashToken(token));
    if (!r || r.status === "no_match") throw new OpsError(404, "not_found");
    return r;
  }

  /** what the approve page shows */
  async describe(token: string) {
    const r = await this.byToken(token);
    return {
      account: r.targetLabel,
      reason: r.reason,
      status: opsStatus(r),
      expiresAt: r.expiresAt,
      minutes: OPS_VIEW_TTL_MS / 60_000,
    };
  }

  async decide(token: string, verdict: "approve" | "deny") {
    const r = await this.byToken(token);
    const st = opsStatus(r);
    if (st === "expired") throw new OpsError(410, "expired");
    if (st !== "pending") throw new OpsError(409, "already_decided");
    let next: OpsRequest = {
      ...r,
      status: verdict === "approve" ? "approved" : "denied",
      decidedAt: new Date().toISOString(),
    };
    if (verdict === "approve") {
      const approver = await this.users.findByPhone(OPS_APPROVER_PHONE);
      const view = await this.sessions.createOpsView({
        targetUserId: r.targetUserId!,
        impersonatorId: approver?.id ?? "ops-approver",
        ttlMs: OPS_VIEW_TTL_MS,
      });
      next = { ...next, sessionId: view.id };
    }
    if (!(await this.requests.swap(r, next))) {
      if (next.sessionId) await this.sessions.delete(next.sessionId);
      throw new OpsError(409, "already_decided");
    }
    console.log(`[ops] ${next.status} ${r.id} → ${r.targetUserId}`);
    return { status: next.status };
  }

  /** the asker's view of its ask; an approved view's session is handed over once */
  async poll(id: string, pollToken: string) {
    const r = await this.requests.get(id);
    if (!r || r.pollHash !== await hashToken(pollToken)) {
      throw new OpsError(404, "not_found");
    }
    const status = opsStatus(r);
    if (status === "approved" && r.sessionId) {
      const { sessionId: _taken, ...rest } = r;
      const next = { ...rest, deliveredAt: new Date().toISOString() };
      if (await this.requests.swap(r, next)) {
        console.log(`[ops] view taken ${r.id}`);
        return { status, sessionId: r.sessionId, account: r.targetLabel };
      }
    }
    return { status, ...(r.targetLabel ? { account: r.targetLabel } : {}) };
  }
}
