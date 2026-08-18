# UX audit — initial users (first session, mobile-first)

Method: drove the real app via Playwright as a brand-new Spanish-first user on a 390×844
viewport (the ad-traffic profile), phone +15125554001: `/` → signup form → `/verify` →
10-step `/welcome` wizard → first quote via the assistant (quick-quote flow, stub LLM) →
send by text → accepted as the customer on `/q` → back across `/dashboard`, `/quotes`,
`/invoices`, drawer nav; desktop spot-check at 1440×900. Zero console errors all session.
Dev-stub caveat: content produced BY the LLM (descriptions, translations, price/name
extraction quality) can differ with a real key — findings that depend on it are marked
`[LLM-caveat]`.

What already works well (don't break it): compact Spanish-first landing, TX-biased address
autocomplete with "usar tal cual", per-step skips + global skip in the wizard, the
"Mira lo que ve tu cliente" payoff step, distinct starter chips, honest no-email send
adaptation ("Enviar por texto"), persisted `/q` accepted state with name+date, receipts
without self-notifications, truthful `/quotes` hero, localized feed with "hace 1 min".

---

## 🔴 CRITICAL — conversion killers

**UX-01 [LANDING/MOBILE] The signup card — the single conversion point — is clipped at 390px.**
After tapping any "Empezar" CTA (`#contact` anchor), the card's inner content is pushed
~56px right: the headline wraps off-screen ("¿Listo para quitarte e…"), the step tracker
("3 LI…") is cut, and the PHONE INPUT itself extends past the viewport (right edge 399px
on a 390px screen); the "Regístrate" button is clipped too. Measured live. Every ad tap
lands here. (The `/verify` card surface has the same bleed — interactive elements fit
(button right=385) but the white card + "3 LISTO" tracker are visibly cut.)

**UX-02 [FIRST-WIN] The user's first accepted quote is invisible everywhere — the aha
moment reads as "nothing happened".** After María accepts the $3,700 quote (status
`approved`, verified via API):
- Dashboard "Trabajos activos: 0" with empty-state copy "En cuanto un cliente firme una
  cotización, el trabajo aparecerá aquí" — she *just* signed one. `/api/jobs` returns []
  for an approved quote that has an auto-created draft contract (the draft contract
  appears to disqualify it from won/job classification).
- The $3,700 vanishes from every number: awaiting → 0 (correct), but no "ganado/por
  facturar" bucket exists; "Por cobrar $0"; the win's value appears nowhere.
- "Cotizaciones esperando firma" panel says "Aún no hay cotizaciones enviadas. Prepara
  una en el asistente." — factually false (one was sent AND accepted).
- No next-step CTA anywhere: dashboard, `/quotes` open panel (only "Copiar enlace / Ver
  como cliente"), and `/invoices` empty state ("Una vez firmado un contrato, agrega la
  primera factura" — one IS signed) all fail to offer "Crear la factura para María".
- The assistant conversation never learns of the acceptance: header still reads
  "Cotización + Acuerdo enviada para firma", the thread badge stays "Contrato enviado",
  no acceptance divider / "Continuar a la factura" CTA appears, and the "Enviar por
  texto" button is STILL ACTIVE on the accepted doc (invites duplicate sends).
The single activity-feed line "Tu cliente aceptó tu cotización" is the only trace.

**UX-03 [SEND MOMENT] The first send confirmation is self-contradictory.** The
confirmation card fuses "Contrato enviado ✓" with "no hay correo registrado — agrega uno
a María Nguyen **para enviar**" — did it send or not? (It sent, by text.) Plus the
terminology whiplash survives in this exact moment: header says "Cotización + Acuerdo
enviada para firma" while the card and the chip both say "**Contrato** enviado…" and the
thread badge says "Contrato enviado".

## 🟠 MAJOR

**UX-04 [ASSISTANT] The assistant is deaf to what the user already typed.** `[LLM-caveat]`
The quick-quote line "…para la familia Nguyen, **$3,700** todo incluido" is followed by a
price screen starting at **$0** ("¿Cuál es el precio?") and a customer screen asking
"¿Para quién es esto?" — both answers were in the sentence. The $-amount is plain-regex
extractable even without an LLM (prefill + "¿Es $3,700? ✓").

**UX-05 [I18N] Spanish stopword Title-Casing in generated version titles becomes the
customer-facing job name.** The versions render "Instalación **De** Patio" and that string
is STORED as `jobName` — it then headlines the customer's `/q` page, the browser tab, the
quotes list and the decided row. Same `\b`-class bug that P-07 fixed for email heroes,
alive in the version-title/job-name derivation path.

**UX-06 [I18N/TRUST] The EN preview silently keeps the job details in Spanish.**
`[LLM-caveat]` on WHY (stub echoes translations), but the UX gap is real regardless: there
is no "traduciendo…"/failure indicator, so if translation fails in prod the user sends a
mixed-language document without knowing. The "English out" promise needs a visible state.

**UX-07 [ONBOARDING] The assistant coachmark fires AFTER mastery and can feel stuck.**
It appeared on the desktop dashboard after the user had already created, sent, and won a
quote through the assistant — full-app blur, "haz clic en cualquier lugar para cerrar",
but Escape does nothing and clicks over some regions are intercepted by underlying panels
(live-reproduced: click retries exhausted on `.panel__head`). Also mixes metaphors
("Haz clic aquí… **Toca** para empezar"). Suppress once the user has used the assistant;
dismiss on Escape and on ANY pointerdown at the overlay level.

**UX-08 [QUOTES] The accepted quote is a dead end on /quotes mobile.** Tapping the
"Decididas este mes" row does nothing (inert row; only a dismiss ×), so receipts and
actions are unreachable from the list; the `?open=<id>` deep-link renders the panel
below the hero + 4 KPI cards without scrolling it into view. The decided row also shows
"—" where the customer name belongs.

**UX-09 [DASHBOARD/MOBILE] The activity panel header breaks at 390px.** "Los monstruos
han estado ocupados" renders one-word-per-line in a sliver column and "Registro complet…"
is clipped by the right edge.

## 🟡 MINOR

**UX-10 [WIZARD] "Paso 1 de 10" announces a 10-step march before any value.** Steps 7-9
(logo, seguro, y el paso W-9 si aplica) are nice-to-haves parked before the two payoff
steps. Consider: fewer counted steps (fold logo/insurance into the dashboard checklist it
already has), or "Paso 1 de 4 + extras opcionales" framing.

**UX-11 [WIZARD] Step-4 double primary.** "Sí, Texas" (solid green) and "Continuar"
(solid dark green) compete; unclear whether Continuar confirms the guess. One primary.

**UX-12 [ASSISTANT/I18N] English divider chips inside the Spanish chat.** "A little more
info" renders between Spanish bubbles during the quick-quote flow (also seen pre-send).

**UX-13 [ASSISTANT] Customer step nits.** Two "Atrás" controls in one card (top link +
footer button); placeholders clipped in the half-width fields ("Número de tel",
"Correo (opcio…"); the just-typed customer name isn't prefilled `[LLM-caveat]`.

**UX-14 [ASSISTANT] Thread list is unhelpful for returning users.** The one conversation
is titled "Nueva conversación" with preview "garantía: 6 meses" (last checklist item) —
should be job + customer ("Patio · María Nguyen"). The "Nueva conversación" button shows
a **⌘N** hint inside the MOBILE drawer (desktop-keyboard hint on a phone, P-53's cousin).

**UX-15 [DOCS] Raw unformatted phones on the document preview.** De-block shows
"+15125554001", Para-block "5125554002" while the rest of the app formats
"(512) 555-4001". One formatter everywhere (shared/quote-flow/format-helpers exists).

**UX-16 [I18N] `/quotes` browser-tab title is English ("Quotes · Paperwork Monster") in
the ES UI** — dashboard ("Panel") and invoices ("Facturas") are localized.

**UX-17 [QUOTES] Sample-quote presentation confuses the numbers story.** KPI says
"0 cotizaciones en espera / $0" while the track header says "En espera de respuesta · 1
cotización" (the visible-but-excluded MUESTRA card); the sample card renders several
placeholder dashes ("—") and an empty avatar tile. Either count it with a "muestra"
annotation or visually separate it from the real track.

**UX-18 [COPY] Truncation without ellipsis.** The quote summary cuts mid-phrase
("Instalación de patio de adoquines 20x15 para la") on `/q` subtitle and the open panel.

**UX-19 [COPY] Mobile empty-state says "¡Haz clic en una casilla…!"** — click language on
a touch device, and "casilla" (checkbox) for what are option chips. "Toca una opción o
escribe abajo para comenzar."

**UX-20 [DASHBOARD] Feed/KPI panel polish.** The accept event is generic ("Tu cliente
aceptó tu cotización" — no name, no job, not tappable); "Lo más alto del pipeline" renders
as an empty shell with no empty-state copy; "TRABAJO PAGADO PROM." wraps its "Aún no hay
trabajos pagados" value awkwardly as a KPI.

**UX-21 [CHROME] Small desktop/drawer artifacts.** The mobile hamburger renders on
desktop next to the full sidebar (two nav systems); an unlabeled icon-only button sits
above "Cerrar sesión"; the top-right "● hace 4m" pill has no label or tooltip; the
checklist chip "garantía: 6 meses" is still lowercase beside capitalized siblings.

**UX-22 [POST-ACCEPT] The immediate accept confirmation (customer side) is thinner than
the reload.** Right after accepting, the card shows only "✓ Cotización aceptada"; on
reload it shows "Aceptada por María Nguyen el 18 de agosto de 2026" + ACEPTADA badge.
Render the full evidence immediately.

**UX-23 [INVOICES] "Exportar CSV 2026" ghost button is near-invisible** (pale pill on
cream) and questionable on a zero-invoice empty state at all.
