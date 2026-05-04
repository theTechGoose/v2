# Actionable Items — Assistant View

## Assistant Input / Onboarding

- **Add placeholder example to assistant text box.**
  - Example copy: `"help me draft a kitchen remodel quote"`
- **Add a secondary helper line on the input bar.**
  - Copy: `"Need something different? Tell me anything you want — how can I help?"`
- **Onboarding LLM should give example prompts of what the chat can do.**
  - Example user phrasing to model in the UI: `"I have a full bathroom remodel down to the studs, I would like to rebuild the bathroom."`

## Quick-Start Boxes (Assistant Entry Points)

Make the entry-point boxes more specific. Replace generic copy with these three options:

1. `"I already have my price range — please help me draft the scope."`
2. `"I have all of the job details and would like help with pricing appropriately."`
3. `"I have some of the job details and need a simple quote."`

## Quote Completion Flow

- **Remove the "drafted" text** from the completion state.
- **Move the "Lock in Quote" box up** so it sits directly under the completed quote.
- **Update completion copy** to:
  - `"Paperwork assistant has completed your quote. Is this for a business or a person?"`
- **Branching follow-up after business vs. person selection:**
  - If **business** → ask for: business name, phone, email.
  - If **person** → ask for: customer name, phone, email.
- Add a clear prompt: `"What is your customer's name?"`

## Quote Preview

- **Make the quote editable directly in the quote preview.**
- **For any editable text field**, enable:
  - Spell check
  - Grammar check

## Contract View (After Signing)

- **Add post-signing notice** to the contract view:
  - `"Please allow up to 2 minutes before checking your email inbox. Don't forget to check spam."`
