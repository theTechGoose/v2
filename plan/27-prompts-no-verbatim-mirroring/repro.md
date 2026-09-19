# Repro — the prompts permit (and one instructs) echoing

## Read the prompts
```
sed -n 1771p lang/en.json | grep -o "mirror it back[^\\\\]*"      # "mirror it back cleaned-up rather than padding with assumptions"
sed -n 1763p lang/en.json | grep -c "verbatim"                     # 0 — nothing forbids returning the sentence
diff <(sed -n 1763p lang/en.json) <(sed -n 1763p lang/es.json) && echo "es prompt identical to en (expected)"
```

## Observe with a real key
With `OPENAI_API_KEY` set, send a deliberately vague sentence (`fix stuff at the house`) through polish (`POST /api/agents/job-details/polish`) → the model, following the last rule, returns the sentence cleaned up rather than a scope line.

## Red test
`cd jest && npx jest unit/i18n-dictionary-consistency.test.ts` after adding the "contains 'Never return the contractor's sentence verbatim'" / "does not contain 'mirror it back'" assertions.
