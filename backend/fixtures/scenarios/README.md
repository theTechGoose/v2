## Assistant test scenarios

Each `*.json` file describes a realistic user flow with the assistant. Schema:

```jsonc
{
  "id": "kebab-case-id",
  "name": "Human-readable name",
  "description": "What this exercises",
  "category": "create_quote | lock_quote | terms_transition | discovery | edge_case | recurring | revision",
  "initialState": {
    "userId": "user-1",
    "customerId": "cust-acme",         // optional, set if pre-linked
    "quoteId": null,                    // optional pre-existing state
    "phase": "quote"                    // "quote" | "terms"
  },
  "turns": [
    {
      "user": { "content": "...", "kind": "text" },
      "expect": {
        "action": {                     // optional — expected LLM tool call
          "type": "create_quote",
          "payload": { "summary": "...", "lineItems": [ /* ... */ ] }
        },
        "responseKinds": ["text", "action_card"], // server-emitted message kinds
        "assistantContains": ["quote"]   // substrings expected in assistant text
      }
    }
  ]
}
```

`expect.action.payload` is a *fuzzy* expectation — fields not specified are not asserted; line item amounts are in **cents**.
