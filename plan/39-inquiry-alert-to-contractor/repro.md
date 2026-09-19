# Repro — "Ask a question" on the quote link goes nowhere the contractor can read

## Steps
1. `deno task serve`; log in as the contractor (with email + phone); send a quote; copy the `/q/<id>` link.
2. In a private window open the link; at the bottom use "Ask a question": type a question, fill "contact me back", submit → "✓ Question sent — your contractor will follow up directly."
3. As the contractor: check email and SMS → nothing. Open `/dashboard` → the activity feed shows "<name> asked a question" — the question text itself is not rendered. There is no bell, and `/messages` redirects to `/assistant`.
4. The "contact me back" value is not stored anywhere.

## Confirm in code
```
sed -n 574,604p backend/src/paperwork/entrypoints/public-controller/mod.ts    # emits a bus event only
sed -n 493,500p backend/src/paperwork/entrypoints/public-controller/mod.ts    # contrast: accept fires SendAcceptedAlert
sed -n 237,247p backend/src/communication/domain/coordinators/notify-on-event/mod.ts   # the only sink: a notification row
sed -n 250,257p front-end/islands/DashboardPage.tsx                           # renders n.title only, never n.body
sed -n 159,162p front-end/islands/DashTopbar.tsx                              # no bell
cat front-end/routes/messages/index.tsx                                       # 302 → /assistant
```

## Red test
`cd backend && deno test -A --unstable-kv src/paperwork/domain/coordinators/send-inquiry-alert/int.test.ts` (coordinator does not exist).
