# 7.11 ⬜ NW-52 — Soft delete + "recover the old account" on repeat-phone signup (L) · slug `nw-52-soft-delete`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.11) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** Every delete is a hard KV delete (`core/data/repository/mod.ts:75-79`, `quote-store:93-100`, `customer-store:88-95`, `user-store:168-175` — which also frees `user_by_phone`); `verify-otp/mod.ts:180-194` is pure find-or-create.
- [ ] RED Deno int: quote/customer `delete` → row has `deletedAt`, list endpoints exclude it, `get` by id still works for owners with `includeDeleted`; user delete keeps `user_by_phone`; `VerifyOtp` on a deleted user returns `{ recoverable: true }` without creating a new account; `POST /auth/recover` clears `deletedAt`; `POST /auth/start-fresh` re-keys the old user's phone (`user_by_phone_archived`) and creates a new one.
- [ ] RED jest integration + e2e (`/verify` shows "Recover my account / Start fresh" when the phone belonged to a deleted account).
- [ ] EDIT: `deletedAt?: string` on User/Quote/Customer DTOs; stores `update({deletedAt})` instead of `kv.delete`; list filters; `verify-otp` branch + two new routes; `DeleteQuoteButton.tsx:26-38` copy "moved to trash". Keep `wipe-account` as the only hard delete.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Delete scope: do not delete data, flag it as "deleted". When someone signs up with the same phone number, offer to create a new account or recover the old one. [p58]
  - **NW-52 ⬜ NOT BUILT — every delete is a hard KV delete; repeat-phone signup silently logs into the old account.** Effort L.
  - Evidence: zero hits for `deletedAt|isDeleted|softDelete|archived`. Hard deletes: `core/data/repository/mod.ts:75-78`;
    quotes `quote-store/mod.ts:93-100`; customers `customer-store/mod.ts:88-95`; account `me-controller/mod.ts:51-59` →
    `user-store/mod.ts:168-175` (also deletes `user_by_phone`, releasing the number); nuclear `wipe-account/mod.ts:28-78`
    (`GET /me/wipe`). UI `DeleteQuoteButton.tsx:27-38` confirm → delete → reload. Signup: `verify-otp/mod.ts:178-192` is pure
    find-or-create; `user-store.create` (`:53`) guards one account per phone.
  - Fix: nullable `deletedAt` on User/Quote/Customer DTOs; stores `update({deletedAt})` + filter from lists; `verify-otp` returns
    `{recoverable:true}` for a flagged user so `/verify` can offer recover / start fresh. Tests: none.

## Code at the cited lines (read from this tree while packaging)

### `backend/src/core/data/repository/mod.ts:75-79`

```
75:   async delete(id: string): Promise<void> {
76:     await this.get(id);
77:     const kv = await getKv();
78:     await kv.delete([this.prefix, id]);
79:   }
```

### `backend/src/users/domain/coordinators/verify-otp/mod.ts:180-194`

```
180:     const existing = await this.users.findByPhone(phone);
181:     const language = deriveLanguageOnVerify(existing, otp.language);
182:     const user = existing
183:       ? (language && language !== existing.language
184:           ? await this.users.update(existing.id, { language })
185:           : existing)
186:       : await this.users.create({
187:           phoneNumber: phone,
188:           language,
189:           name: placeholderNameFor(language),
190:         });
191: 
192:     if (!existing) await this.notifyNewSignup(user);
193:     const session = await this.sessions.create(user.id);
194:     return { sessionId: session.id, userId: user.id, isNewUser: !existing };
```

### `front-end/islands/DeleteQuoteButton.tsx:26-38`

```
26:   async function onClick(e: MouseEvent) {
27:     e.stopPropagation();
28:     if (busy) return;
29:     if (!globalThis.confirm(resolvedConfirm)) return;
30:     setBusy(true);
31:     try {
32:       await quotesClient.delete(id);
33:       globalThis.location.reload();
34:     } catch (err) {
35:       setBusy(false);
36:       globalThis.alert(tFor(lang, "deleteQuoteButton.error", { message: (err as Error).message }));
37:     }
38:   }
```
