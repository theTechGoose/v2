# Repro — deletes are permanent; signing up again with the same phone silently reopens the old account

## Steps
1. `deno task serve`; log in with `+15125550990`; create a customer and a quote; delete the quote from `/quotes` (confirm dialog) → gone; `GET /api/quotes/<id>` → 404. No trash, no undo.
2. `/settings` → delete account (or `GET /api/me/wipe`) → the user row and its phone index are removed.
3. Log in again with `+15125550990` → a brand-new empty account is created with no prompt; if instead only data was deleted, logging in resurrects the old account with no choice offered. p58 wants: flag as deleted; on repeat-phone signup offer "recover the old one" or "start fresh".

## Confirm in code
```
grep -rn "deletedAt\|isDeleted\|softDelete" backend/src || echo "no soft-delete anywhere"
sed -n 93,100p backend/src/paperwork/domain/data/quote-store/mod.ts     # atomic hard delete
sed -n 168,175p backend/src/users/domain/data/user-store/mod.ts          # also deletes user_by_phone
sed -n 180,194p backend/src/users/domain/coordinators/verify-otp/mod.ts  # pure find-or-create
sed -n 26,38p front-end/islands/DeleteQuoteButton.tsx                    # confirm() → delete → reload
```

## Red test
Deno int tests on the stores + `verify-otp` (`{ recoverable: true }` branch does not exist).
