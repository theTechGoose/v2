/**
 * REQ-912c — GET /me/systems: what DocuMonster is wired to for this account, in one call —
 * email (Postmark, the house sender), the phone line (REQ-903/904), card payments (Stripe /
 * Square as Billing knows them), e-signature (DocuMonster's own, always on), and the HR
 * provisioning registry (REQ-888 / REQ-913); REQ-920d: a customer line's texting registration. Lives in the HR module because that is where the
 * registry is; everything else it reads is an imported module's.
 */
import { Context, Controller, Get } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { ConnectStripe } from "@users/domain/coordinators/connect-stripe/mod.ts";
import { ConnectSquare } from "@users/domain/coordinators/connect-square/mod.ts";
import { HOUSE_FROM } from "@communication/domain/business/sender/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { ownsEnvLine } from "@communications/domain/business/line-resolution/mod.ts";
import { A2pStore } from "@communications/domain/data/a2p-store/mod.ts";
import { a2pSummary } from "@communications/domain/business/a2p/mod.ts";
import type { A2pSummary } from "@communications/dto/mod.ts";
import { HrSystemStore, SYSTEM_CATALOG } from "@hr/domain/data/hr-stores/mod.ts";

export type LineSummary =
  | { status: "none" }
  | { status: "active"; number: string; kind: "env" }
  | { status: "active"; number: string; kind: "subaccount"; a2p: A2pSummary }
  | { status: "released"; number: string; kind: "subaccount" };

@Controller("me/systems")
export class SystemsController {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private stripe: ConnectStripe,
    private square: ConnectSquare,
    private lines: LineStore,
    private comms: CommsConfigSource,
    private systems: HrSystemStore,
    private a2p: A2pStore,
  ) {}

  @Get()
  async summary(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const [stripe, square, line, systems] = await Promise.all([
      this.stripe.status(user.id).catch(() => ({ connected: false })),
      this.square.status(user.id).catch(() => ({ connected: false })),
      lineSummary(user.id, this.comms, this.lines, this.a2p),
      this.systems.listByUser(user.id),
    ]);
    const sorted = systems.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      email: { provider: "postmark", configured: Boolean(Deno.env.get("POSTMARK_API_KEY")), from: HOUSE_FROM },
      line,
      payments: { stripe: { connected: stripe.connected }, square: { connected: square.connected } },
      esign: { provider: "documonster", on: true },
      hr: { systems: sorted, catalog: SYSTEM_CATALOG.filter((c) => !sorted.some((s) => s.key === c.key)) },
    };
  }
}

// a helper outside the class: Danet registers every prototype method of a controller as a route
async function lineSummary(userId: string, comms: CommsConfigSource, lines: LineStore, a2p: A2pStore): Promise<LineSummary> {
  const cfg = comms.get();
  if (ownsEnvLine(userId, cfg)) return { status: "active", number: cfg.from, kind: "env" };
  const line = await lines.findByUser(userId);
  if (!line) return { status: "none" };
  if (line.status === "released") return { status: "released", number: line.number, kind: "subaccount" };
  return { status: "active", number: line.number, kind: "subaccount", a2p: a2pSummary(await a2p.get(line.id)) };
}
