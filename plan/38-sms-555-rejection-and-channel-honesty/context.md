# 7.2 🐛 NW-25 — Reject 555 numbers before Twilio; report each channel honestly (M) · slug `nw-25-sms-honesty`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.2) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** Only shape checks exist (`send-paperwork-sms/mod.ts:365-373`, `users/domain/business/normalize-phone/mod.ts:8-28`); Twilio errors return the raw JSON (`users/domain/data/sms/mod.ts:93-99`);
the invoice page collapses two channels into one boolean (`InvoicesPage.tsx:1494-1499`) and reports only the email reason (`:1504-1513`).

- [ ] RED Deno unit (`normalize-phone/test.ts`): `normalizePhone("(512) 555-0123")` throws `phone_fictional`; `"(512) 655-0123"` passes. (555-01xx is the reserved fictional block; plain 555 exchange numbers also fail Twilio — reject the whole `555` exchange for US numbers.)
- [ ] RED Deno unit (`users/domain/data/sms/test.ts`): a Twilio 400 body with `"code":21211` → `reason: "sms.invalidNumber"` (a lang key), likewise 21610 → `sms.optedOut`, 21614 → `sms.notMobile`.
- [ ] RED jest unit (`jest/unit/send-result.test.ts`): a new pure `summarizeDispatch({ email:{delivered:true}, text:{delivered:false, reason:"sms.invalidNumber"} })` → `{ delivered: true, partial: true, failedChannels:["text"] }`.
- [ ] RED e2e (`cypress/e2e/invoice-send-honesty.cy.ts`): customer phone `+15125550100` → send "Text + Email" → the page says the email went and the text failed (`[data-cy=send-partial]`), not a silent reload.
- [ ] EDIT: `normalize-phone` + `send-paperwork-sms:365-373` reject the 555 exchange with a translated reason; `sms/mod.ts:93-99` map the three Twilio codes to keys (both dicts); `InvoicesPage.tsx:1494-1513` compute per-channel outcomes and show the partial message; `:1686-1688`/`:1719-1721` reload only when nothing failed.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- On "send": the email went out but the text failed with Twilio 400, error 21211 "Invalid 'To' Phone Number: +1555555XXXX". Assume it is just because I used a fake cell number. I did receive the quote via email. [p16]
  - **NW-25 🐛 the guess is right (Twilio rejects 555 fictional numbers with 21211), but three defects sit under it.** Effort M.
  - Evidence: the only gate before Twilio is shape-only — `send-paperwork-sms/mod.ts:365-373` `normalizeE164` (10 digits → +1,
    11 starting 1 → +); `users/domain/business/normalize-phone/mod.ts:8-28` same (its own test uses `(512) 555-1234` as valid). No
    fictional/21211 guard anywhere in `backend/`. `users/domain/data/sms/mod.ts:93-99` returns the raw Twilio JSON as the reason
    string. Assistant quote send is honest (`send-quote/mod.ts:237-241` → `sendQuote.divider.emailedTextFailed`,
    `lang/en.json:2206`; recovery card `AsstChat.tsx:5036-5038` matches `/Invalid|21211/`). **Invoice sends are not**:
    `InvoicesPage.tsx:1494-1498` `delivered: email.delivered || text.delivered`; `:1684-1687` and `:1717-1719` reload on
    `delivered`; `d.text` is never read; `dispatchFailureCopy` `:1504-1513` reports only email.
  - Fix: reject the 555 exchange in `normalizeE164`/`normalize-phone` with a translated reason; map Twilio 21211/21610/21614 to
    lang keys in `sms/mod.ts`; per-channel outcomes in `InvoicesPage.tsx:1494`.
  - Tests: `jest/unit/send-result.test.ts:60-124` (P-09), `cypress/e2e/invoice-send-honesty.cy.ts` (no-channel case only). Nothing pins 555 rejection or partial failure.

## Code at the cited lines (read from this tree while packaging)

### `backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts:365-373`

```
365: function normalizeE164(raw: string): string | undefined {
366:   const trimmed = raw.trim();
367:   if (!trimmed) return undefined;
368:   if (/^\+[1-9]\d{6,14}$/.test(trimmed)) return trimmed;
369:   const digits = trimmed.replace(/\D/g, "");
370:   if (digits.length === 10) return `+1${digits}`;
371:   if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
372:   return undefined;
373: }
```

### `backend/src/users/domain/business/normalize-phone/mod.ts:8-28`

```
8: export function normalizePhone(input: string): string {
9:   if (typeof input !== "string") throw new Error("phone must be a string");
10:   const trimmed = input.trim();
11:   const hadPlus = trimmed.startsWith("+");
12:   const digits = trimmed.replace(/\D/g, "");
13:   if (digits.length === 0) throw new Error("phone has no digits");
14: 
15:   let normalized: string;
16:   if (hadPlus) {
17:     if (digits.length < 8 || digits.length > 15) {
18:       throw new Error(`phone has invalid length: ${digits.length}`);
19:     }
20:     normalized = `+${digits}`;
21:   } else if (digits.length === 10) {
22:     normalized = `+1${digits}`;
23:   } else if (digits.length === 11 && digits.startsWith("1")) {
24:     normalized = `+${digits}`;
25:   } else {
26:     throw new Error(`phone has unsupported length: ${digits.length}`);
27:   }
28:   return normalized;
```

### `backend/src/users/domain/data/sms/mod.ts:93-99`

```
93:       if (!res.ok) {
94:         const text = await res.text().catch(() => "");
95:         return {
96:           ok: false,
97:           reason: `twilio ${res.status}: ${text.slice(0, 200)}`,
98:         };
99:       }
```

### `front-end/islands/InvoicesPage.tsx:1494-1499`

```
1494:   const [email, text] = await Promise.all(settled.map(interpretSettledSend));
1495:   return {
1496:     delivered: email.outcome.delivered || text.outcome.delivered,
1497:     email,
1498:     text,
1499:   };
```

### `front-end/islands/InvoicesPage.tsx:1504-1513`

```
1504: function dispatchFailureCopy(lang: Lang, d: DispatchResult): string {
1505:   const key = sendResultLangKey(d.email.outcome) ??
1506:     "sendQuote.divider.emailFailed";
1507:   if (key === "sendQuote.divider.noEmail") {
1508:     return tFor(lang, "sendQuote.divider.noEmail");
1509:   }
1510:   return tFor(lang, key, {
1511:     reason: d.email.rawReason ?? d.email.outcome.reason ?? "unknown",
1512:   });
1513: }
```

### `front-end/islands/InvoicesPage.tsx:1494-1513`

```
1494:   const [email, text] = await Promise.all(settled.map(interpretSettledSend));
1495:   return {
1496:     delivered: email.outcome.delivered || text.outcome.delivered,
1497:     email,
1498:     text,
1499:   };
1500: }
1501: 
1502: /** Honest failure copy when NO channel delivered — the same lang keys the
1503:  *  assistant send divider uses. */
1504: function dispatchFailureCopy(lang: Lang, d: DispatchResult): string {
1505:   const key = sendResultLangKey(d.email.outcome) ??
1506:     "sendQuote.divider.emailFailed";
1507:   if (key === "sendQuote.divider.noEmail") {
1508:     return tFor(lang, "sendQuote.divider.noEmail");
1509:   }
1510:   return tFor(lang, key, {
1511:     reason: d.email.rawReason ?? d.email.outcome.reason ?? "unknown",
1512:   });
1513: }
```

### `front-end/islands/InvoicesPage.tsx:1686-1688`

```
1686:       const d = await dispatchInvoice(inv.id);
1687:       if (d.delivered) globalThis.location.reload();
1688:       else setSendFail(dispatchFailureCopy(lang, d));
```

### `front-end/islands/InvoicesPage.tsx:1719-1721`

```
1719:       const d = await dispatchInvoice(inv.id);
1720:       if (d.delivered) globalThis.location.reload();
1721:       else setSendFail(dispatchFailureCopy(lang, d));
```
