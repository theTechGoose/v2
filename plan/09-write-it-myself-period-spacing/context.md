# 1.9 🐛 NW-17 — "Write it myself." gets its period and breathing room (S) · slug `nw-17-write-it-myself-period`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.9) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `lang/en.json:256` `asstChat.jobOpts.customTitle` = "Write it myself" (no period); the pill `.chat__details-writeself`
(`static/assistant-page.css:8225-8237`) sits directly under the prompt bubble ending in ".", which reads as one run-on line.

- [ ] RED — jest unit: in `jest/unit/i18n-dictionary-consistency.test.ts` add `it("REQ-NNN NW-17 the write-it-myself pill ends with a period")`:
      `en["asstChat.jobOpts.customCta"]` = "Write it myself." and `es[...]` = "Escribirlo yo mismo.". Run → fails (key missing).
- [ ] EDIT: add a NEW key `asstChat.jobOpts.customCta` ("Write it myself." / "Escribirlo yo mismo.") in both dicts; use it at `AsstChat.tsx:4409` (the pill).
      Leave `customTitle` (no period) for the picker tile at `:4186`, where a trailing period would look wrong.
- [ ] EDIT `static/assistant-page.css:8225`: add `margin-top: 8px;` to `.chat__details-writeself`.
- [ ] Done when: the pill reads "✎ Write it myself." on its own line under the bubble.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- The chip at the bottom reads "I know the job, help me price it.Write it myself". Needs a space after the period and a period at the end of "myself". [p26]
  - **NW-17 ⚠ concatenation not reproducible in the render tree; 🐛 the missing period is real.** Effort S.
  - Evidence: `asstChat.prompt.helpPrice` (`lang/en.json:354` "I know the job, help me price it.") renders once, as a chip
    (`:4879-4885`); `asstChat.jobOpts.customTitle` (`:256` "Write it myself", no period) at `:4186/:4409/:4418`. Chips and the
    details step are exclusive ternary branches (`:3875, :4327, :4577, :4676, :4730, :4749`, else `:4870-4901`). The nearest
    adjacency: the prompt bubble ends "." and the next sibling is the `.chat__details-writeself` pill → a text extraction reads
    "….✎ Write it myself". Dead key noticed: `asstChat.price.backToPrompts` (`:342`) has zero references.
  - Fix: add the period to `customTitle` in both dicts; give `.chat__details-writeself` a separator/margin (`static/assistant-page.css:8225-8241`).

## Code at the cited lines (read from this tree while packaging)

### `lang/en.json:253-259`

```
253:   "asstChat.jobOpts.customEmpty": "Type the job details first.",
254:   "asstChat.jobOpts.customHint": "Write the job details yourself.",
255:   "asstChat.jobOpts.customPlaceholder": "Describe the job — one item per line.",
256:   "asstChat.jobOpts.customTitle": "Write it myself",
257:   "asstChat.jobOpts.deleteBullet": "Delete bullet",
258:   "asstChat.jobOpts.editTitle": "Edit title",
259:   "asstChat.jobOpts.heading": "Job Details",
```

### `front-end/static/assistant-page.css:8225-8237`

```
8225: .chat__details-writeself {
8226:   align-self: flex-start;
8227:   appearance: none;
8228:   border: 1px dashed var(--line, #d8e0d4);
8229:   background: #fff;
8230:   color: var(--brand-teal, #1a535c);
8231:   font-size: 13px;
8232:   font-weight: 700;
8233:   padding: 8px 14px;
8234:   border-radius: 999px;
8235:   cursor: pointer;
8236:   transition: border-color 0.12s, background 0.12s, color 0.12s;
8237: }
```

### `front-end/islands/AsstChat.tsx:4406-4412`

```
4406:                           class="chat__details-writeself"
4407:                           onClick={openWriteMyself}
4408:                         >
4409:                           ✎ {tFor(lang, "asstChat.jobOpts.customTitle")}
4410:                         </button>
4411:                       )
4412:                       : null}
```

### `front-end/islands/AsstChat.tsx:4183-4189`

```
4183:                                 >
4184:                                 </span>
4185:                                 <span class="chat__jobopt-name">
4186:                                   {tFor(lang, "asstChat.jobOpts.customTitle")}
4187:                                 </span>
4188:                               </div>
4189:                               {selectedOptionId === CUSTOM_OPTION_ID
```

### `front-end/static/assistant-page.css:8222-8228`

```
8222: }
8223: 
8224: /* "Write it myself" trigger on the job-details step (roadmap p.5). */
8225: .chat__details-writeself {
8226:   align-self: flex-start;
8227:   appearance: none;
8228:   border: 1px dashed var(--line, #d8e0d4);
```
