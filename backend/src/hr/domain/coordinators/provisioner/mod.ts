/**
 * REQ-888 — MONSTERIZED: the provisioning engine. An arm per system in the plan (the department's
 * current connected systems, else the hire's snapshot): a system with a webhook gets the hire
 * POSTed to it (2xx → ok, else fault with the reason); one without is manual until the admin
 * marks it done. Each arm's result stays on the hire; the status is `provisioning` until every
 * arm is ok or done, then `active`. No rollback — a half-built hire shows which arm failed and
 * the admin retries that one. Offboarding runs the same arms in reverse.
 */
import { Injectable } from "#danet/core";
import {
  DepartmentStore,
  HireStore,
  HrSystemStore,
} from "@hr/domain/data/hr-stores/mod.ts";
import {
  aggregateProvisioning,
  fullName,
  provisionPlan,
} from "@hr/domain/business/onboarding/mod.ts";
import type { Hire, HrSystem, ProvisionResult } from "@hr/dto/hr.ts";

const WEBHOOK_TIMEOUT_MS = 10_000;
const log = (line: string) => console.log(`[hr/provisioner] ${line}`);

/** what a webhook sees: never the token */
export function hirePayload(h: Hire): Record<string, unknown> {
  return {
    id: h.id,
    firstName: h.firstName,
    lastName: h.lastName,
    name: fullName(h),
    email: h.email,
    phone: h.phone,
    departmentId: h.departmentId,
    departmentName: h.departmentName,
    startDate: h.startDate,
    status: h.status,
    signedAt: h.signedAt,
  };
}

@Injectable()
export class Provisioner {
  /** test seam */
  fetchOverride: typeof fetch | null = null;

  constructor(
    private hires: HireStore,
    private depts: DepartmentStore,
    private systems: HrSystemStore,
  ) {}

  private async call(
    event: "hire.provision" | "hire.offboard",
    hire: Hire,
    sys: HrSystem,
  ): Promise<{ ok: boolean; detail: string | null }> {
    const f = this.fetchOverride ?? globalThis.fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await f(sys.webhookUrl!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event,
          hire: hirePayload(hire),
          system: { id: sys.id, key: sys.key, name: sys.name, kind: sys.kind },
          at: new Date().toISOString(),
        }),
        signal: ctl.signal,
      });
      const text = await res.text().catch(() => "");
      if (res.ok) return { ok: true, detail: text.slice(0, 200) || null };
      return {
        ok: false,
        detail: `webhook answered ${res.status}: ${text.slice(0, 200)}`,
      };
    } catch (e) {
      return { ok: false, detail: `webhook failed: ${(e as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async plan(hire: Hire): Promise<HrSystem[]> {
    const [dept, systems] = await Promise.all([
      this.depts.find(hire.departmentId),
      this.systems.listByUser(hire.userId),
    ]);
    return provisionPlan(
      hire,
      dept && dept.userId === hire.userId ? dept : null,
      systems,
    );
  }

  /** REQ-888c — every arm, or one (`onlySystemId`, a retry) */
  async run(hire: Hire, onlySystemId?: string): Promise<Hire> {
    const plan = await this.plan(hire);
    const now = new Date().toISOString();
    const results: ProvisionResult[] = [];
    for (const sys of plan) {
      const prev = hire.provisioning.find((r) => r.systemId === sys.id);
      if (onlySystemId && sys.id !== onlySystemId && prev) {
        results.push(prev);
        continue;
      }
      if (
        prev && (prev.state === "ok" || prev.state === "done") && !onlySystemId
      ) {
        results.push(prev); // never rebuild what stands
        continue;
      }
      if (!sys.webhookUrl) {
        results.push({
          systemId: sys.id,
          name: sys.name,
          state: prev?.state === "done" ? "done" : "manual",
          detail: null,
          at: now,
        });
        continue;
      }
      const r = await this.call("hire.provision", hire, sys);
      results.push({
        systemId: sys.id,
        name: sys.name,
        state: r.ok ? "ok" : "fault",
        detail: r.detail,
        at: new Date().toISOString(),
      });
      if (!r.ok) log(`${hire.id} ${sys.name}: ${r.detail}`);
    }
    return await this.settle(hire, results);
  }

  /** REQ-888c — a manual arm the admin built by hand */
  async markDone(hire: Hire, systemId: string): Promise<Hire | null> {
    const idx = hire.provisioning.findIndex((r) => r.systemId === systemId);
    if (idx < 0) return null;
    const results = hire.provisioning.map((r, i) =>
      i === idx
        ? { ...r, state: "done" as const, at: new Date().toISOString() }
        : r
    );
    return await this.settle(hire, results);
  }

  private async settle(hire: Hire, results: ProvisionResult[]): Promise<Hire> {
    const now = new Date().toISOString();
    const status = aggregateProvisioning(results);
    return await this.hires.put({
      ...hire,
      provisioning: results,
      status,
      activeAt: status === "active" ? (hire.activeAt ?? now) : hire.activeAt,
      updatedAt: now,
    });
  }

  /** REQ-888d — the same arms in reverse: every built account is torn down */
  async offboard(hire: Hire): Promise<Hire> {
    const systems = await this.systems.listByUser(hire.userId);
    const results: ProvisionResult[] = [];
    for (const r of hire.provisioning) {
      if (r.state !== "ok" && r.state !== "done") {
        results.push(r);
        continue;
      }
      const sys = systems.find((s) => s.id === r.systemId);
      if (!sys?.webhookUrl) {
        results.push({
          ...r,
          state: "torn_down",
          detail: "offboarded — deactivate by hand",
          at: new Date().toISOString(),
        });
        continue;
      }
      const c = await this.call("hire.offboard", hire, sys);
      results.push({
        ...r,
        state: c.ok ? "torn_down" : "teardown_fault",
        detail: c.detail,
        at: new Date().toISOString(),
      });
    }
    const now = new Date().toISOString();
    return await this.hires.put({
      ...hire,
      provisioning: results,
      status: "offboarded",
      offboardedAt: now,
      updatedAt: now,
    });
  }
}
