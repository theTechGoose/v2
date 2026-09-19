# 1.11 🐛 NW-34 — Phone numbers format as `(555) 123-4567` while typing (S) · slug `nw-34-phone-input-mask`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.11) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** The as-you-type mask exists three times privately (`LoginForm.tsx:12-18`, `TrialSignup.tsx:11-17`, `LandingScripts.tsx:586-592`) and is
applied to none of the customer inputs: `ClientsPage.tsx:198-204`, `AsstChat.tsx:7809-7816`, the `/invoices` new-customer modal (`newPhone` state at `InvoicesPage.tsx:2342`).
`shared/quote-flow/format-helpers.ts:66-70` only has the display formatter.

- [ ] RED — jest unit: `jest/unit/format-helpers.test.ts` add `describe("REQ-NNN NW-34 formatPhoneInput as-you-type")` using the lazy `fh()` helper:
      `"5"`→`"(5"`, `"512"`→`"(512"`, `"5125"`→`"(512) 5"`, `"5125556"`→`"(512) 555-6"`, `"5125556999"`→`"(512) 555-6999"`, `"15125556999"`→`"(512) 555-6999"`,
      `"512555699912"`→`"(512) 555-6999"` (extra digits dropped), `""`→`""`. Run → fails (not exported).
- [ ] RED — e2e: `cypress/e2e/clients-page-quality.cy.ts` add `it("REQ-NNN NW-34 the phone field masks as you type")`: open the add-customer form,
      type `5125556999` into `input[type=tel]`, assert `.should("have.value", "(512) 555-6999")`. Run → fails.
- [ ] EDIT `shared/quote-flow/format-helpers.ts`: add `export function formatPhoneInput(raw: string): string` = the `LandingScripts.tsx:586-592` body,
      but first run the digits through `tenDigits()` (`:54-59`) so a leading 1 is stripped, then `.slice(0, 10)`.
- [ ] EDIT the three inputs to `value={formatPhoneInput(x)}` (the `onInput` setters stay as they are; the backend's `normalize-phone` already accepts `(512) 555-1234`):
      `ClientsPage.tsx:200`, `AsstChat.tsx:7813`, and the `newPhone` input in `InvoicesPage.tsx` (search `value={newPhone}`).
- [ ] EDIT de-duplicate: `LoginForm.tsx:12-18` and `TrialSignup.tsx:11-17` import `formatPhoneInput` from `shared/quote-flow/format-helpers.ts` and delete the private copies.
      (`LandingScripts.tsx` is a browser script string — leave it.)
- [ ] GREEN: unit + e2e green; `cd cypress && npx cypress run --spec 'e2e/auth-*.cy.ts'` still green.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Format phone numbers as (555) 123-4567 as they are typed. That is sexy. [p30]
  - **NW-34 🐛 the as-typed mask exists — on the login/landing inputs only — and is never applied to any customer input.** Effort S.
  - Evidence: no mask on `ClientsPage.tsx:196-205` (submitted verbatim `:76`), `AsstChat.tsx:7809-7816` (`createPhone`),
    `InvoicesPage.tsx:2342` (`newPhone`). `shared/quote-flow/format-helpers.ts:66-70` `formatPhoneDisplay` is display-only and
    yields "+1 (512) 555-6999". The real as-typed mask is duplicated inline in `LoginForm.tsx:12-18` (`value` `:75`),
    `TrialSignup.tsx:11`, `LandingScripts.tsx:586-596,625` → "(512) 555-1234". Settings uses `fmtPhone` display-only (`SettingsPage.tsx:16,1559`); WelcomeWizard has no phone input.
  - Fix: export `formatPhoneInput` from `format-helpers.ts`, apply as `value={formatPhoneInput(x)}` on the three customer inputs,
    de-duplicate the auth screens. Tests: `jest/unit/format-helpers.test.ts:78-87` (P-64 display), `clients-page-quality.cy.ts:81` (tel href). None for as-typed.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/LoginForm.tsx:12-18`

```
12: function formatPhoneDisplay(raw: string): string {
13:   const digits = raw.replace(/\D/g, "").slice(0, 10);
14:   const a = digits.slice(0, 3), b = digits.slice(3, 6), c = digits.slice(6);
15:   if (digits.length <= 3) return a;
16:   if (digits.length <= 6) return `(${a}) ${b}`;
17:   return `(${a}) ${b}-${c}`;
18: }
```

### `front-end/islands/TrialSignup.tsx:11-17`

```
11: function formatPhoneDisplay(raw: string): string {
12:   const digits = raw.replace(/\D/g, "").slice(0, 10);
13:   const a = digits.slice(0, 3), b = digits.slice(3, 6), c = digits.slice(6);
14:   if (digits.length <= 3) return a;
15:   if (digits.length <= 6) return `(${a}) ${b}`;
16:   return `(${a}) ${b}-${c}`;
17: }
```

### `front-end/islands/LandingScripts.tsx:586-592`

```
586:     function formatPhoneInput(v: string): string {
587:       const d = v.replace(/\D/g, "").slice(0, 10);
588:       if (!d) return "";
589:       if (d.length < 4) return "(" + d;
590:       if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3);
591:       return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
592:     }
```

### `front-end/islands/ClientsPage.tsx:198-204`

```
198:               <input
199:                 type="tel"
200:                 value={addPhone}
201:                 onInput={(e) =>
202:                   setAddPhone((e.target as HTMLInputElement).value)}
203:                 style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
204:               />
```

### `front-end/islands/AsstChat.tsx:7809-7816`

```
7809:             <input
7810:               type="tel"
7811:               class="cust-pick__search"
7812:               placeholder={tFor(lang, "asstChat.customerStep.phonePlaceholder")}
7813:               value={createPhone}
7814:               onInput={(e) =>
7815:                 setCreatePhone((e.target as HTMLInputElement).value)}
7816:             />
```

### `front-end/islands/InvoicesPage.tsx:2339-2345`

```
2339: ) {
2340:   const [clientSel, setClientSel] = useState("");
2341:   const [newName, setNewName] = useState("");
2342:   const [newPhone, setNewPhone] = useState("");
2343:   const [newEmail, setNewEmail] = useState("");
2344:   const [amount, setAmount] = useState("");
2345:   const [dueDate, setDueDate] = useState(() => {
```

### `shared/quote-flow/format-helpers.ts:66-70`

```
66: export function formatPhoneDisplay(raw: string): string {
67:   const digits = tenDigits(raw);
68:   if (digits.length !== 10) return raw.trim();
69:   return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
70: }
```

### `front-end/islands/LandingScripts.tsx:54-59`

```
54:   "doc.c.title",
55:   "doc.c.l1",
56:   "doc.c.l2",
57:   "doc.c.l3",
58:   "doc.c.l4",
59:   "doc.c.status",
```

### `front-end/islands/ClientsPage.tsx:197-203`

```
197:               {tFor(lang, "settings.phone")}
198:               <input
199:                 type="tel"
200:                 value={addPhone}
201:                 onInput={(e) =>
202:                   setAddPhone((e.target as HTMLInputElement).value)}
203:                 style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
```

### `front-end/islands/AsstChat.tsx:7810-7816`

```
7810:               type="tel"
7811:               class="cust-pick__search"
7812:               placeholder={tFor(lang, "asstChat.customerStep.phonePlaceholder")}
7813:               value={createPhone}
7814:               onInput={(e) =>
7815:                 setCreatePhone((e.target as HTMLInputElement).value)}
7816:             />
```
