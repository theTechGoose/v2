# Repro — "…help me price it.Write it myself"

## Steps
1. `deno task serve`; log in; `/assistant` → click "I know the job, help me price it."
2. Look under the prompt bubble: the pill reads "✎ Write it myself" with no period, sitting flush under a bubble that ends with a period.
   Select the text from the bubble through the pill and copy it → "…help me price it.✎ Write it myself" (the client's p26 reading).

## Confirm in code
```
sed -n 256p lang/en.json; sed -n 256p lang/es.json   # "Write it myself" / "Escribirlo yo mismo", no period
sed -n 4404,4410p front-end/islands/AsstChat.tsx      # the pill
sed -n 8224,8237p front-end/static/assistant-page.css # no top margin
```

## Red test
`cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` after adding the `asstChat.jobOpts.customCta` assertion (key does not exist yet).
