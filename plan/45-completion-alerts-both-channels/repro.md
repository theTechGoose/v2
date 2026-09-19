# Repro — completion alerts go out only on the channels the customer happens to have

## Steps
1. `deno task serve`; create a customer with an EMAIL only; send them a quote; accept it on `/q/<id>`.
2. The contractor gets the completion alert; the customer confirmation goes by email only — no text, because there is no phone on file, and nothing asked for one before sending.
3. Repeat with a phone-only customer → text only, no email.

## Confirm in code
```
sed -n 698,702p front-end/islands/AsstChat.tsx     # channel = both / email-only / sms-only from what is on file
sed -n 442,512p backend/src/paperwork/entrypoints/public-controller/mod.ts | grep -n "acceptedAlert\|signedConfirmation"
```

## Red test
`cd cypress` e2e on the send dialog (folder 43): email-only customer → an inline "Add a phone to also text it" field is offered.
