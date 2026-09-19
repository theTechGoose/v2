# Repro — "SENT" badge before anything was sent

## UI steps
1. `deno task serve`; log in at `http://localhost:5280/login` with any phone + code `000000`; finish onboarding if prompted.
2. Go to `/assistant` → click "I know my price, write it up." → type `Paint a 50ft wooden fence` → send.
3. On the price step type `500` → Continue. You land on the wizard (customer question) inside `/assistant/<threadId>`.
4. Open `/quotes` in another tab.
5. **Expected:** the new quote is a Draft. **Actual:** it is already "Sent" (and the review card later shows the SENT chip) although no email/text went out.

## API steps (no browser)
```
curl -s -c c.txt -X POST localhost:5280/api/auth/verify -H 'content-type: application/json' -d '{"phoneNumber":"+15125550998","code":"000000"}'
curl -s -b c.txt -X POST localhost:5280/api/customers -H 'content-type: application/json' -d '{"name":"Repro Customer","phoneNumber":"+15125550997"}'   # note the id
curl -s -b c.txt -X POST localhost:5280/api/quotes -H 'content-type: application/json' -d '{"customerId":"<id>","summary":"Fence","jobName":"Fence","lineItems":[{"description":"Fence","quantity":1,"unit":"job","price":50000}],"estimatedTotal":50000,"status":"sent"}'
```
→ the response `status` is `"sent"`: the API honours whatever the client posts.

## Confirm in code
```
sed -n 2155,2158p front-end/islands/AsstChat.tsx                    # posts status:"sent" at creation
sed -n 24,28p backend/src/paperwork/domain/data/quote-store/mod.ts   # store default only applies when status is falsy
grep -n "sentAt" backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts   # no output: SMS sends never stamp
```

## Red tests
- `cd jest && npx jest integration/quote-lifecycle.int.test.ts` after adding the "born a draft even with status:'sent'" case.
- `cd cypress && npx cypress run --spec e2e/quotes-status-badges.cy.ts` after adding the price-flow case.
