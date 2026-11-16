/**
 * REQ-903/905 — a customer's line.
 *   GET  /communications/numbers/available?areaCode=843&contains=CLEAN   numbers for sale
 *   POST /communications/numbers {phoneNumber, friendlyName?}            buy → the user's line (409 line_exists)
 *   GET  /communications/line                                            the user's line, redacted (null when none)
 *   POST /communications/line/release                                    give the number back, close the subaccount
 */
import { Body, Context, Controller, Get, Post, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { BadRequestError, parseBuyNumber } from "@communications/dto/mod.ts";
import { parseAreaCode } from "@communications/domain/business/numbers/mod.ts";
import { Lines } from "@communications/domain/coordinators/lines/mod.ts";

@Controller("communications")
export class LinesController {
  constructor(private lines: Lines, private users: UserStore, private sessions: SessionStore) {}

  @Get("numbers/available")
  async available(@Context() ctx: ExecutionContext, @Query("areaCode") areaCode?: string, @Query("contains") contains?: string, @Query("limit") limit?: string) {
    await requireUser(ctx, this.sessions, this.users);
    const area = parseAreaCode(areaCode);
    if (areaCode && !area) throw new BadRequestError("areaCode must be three digits");
    const pattern = (contains ?? "").trim().toUpperCase().replace(/[^A-Z0-9*]/g, "");
    if (!area && !pattern) throw new BadRequestError("areaCode or contains is required");
    return { numbers: await this.lines.search({ ...(area ? { areaCode: area } : {}), ...(pattern ? { contains: pattern } : {}), limit: Number(limit) || 20 }) };
  }

  @Post("numbers")
  async buy(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.lines.buy(user.id, parseBuyNumber(body));
  }

  @Get("line")
  async line(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return { line: await this.lines.get(user.id) };
  }

  @Post("line/release")
  async release(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return { line: await this.lines.release(user.id) };
  }
}
