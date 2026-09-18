# New Working Issues

Source: `new working issues.pdf` (84 pages, dated 2026-09-18). Page numbers are in brackets.
Pages 2–32 are the open **Quote Flow Tasks**. Page 33 is a **COMPLETED TASKS** divider; everything after it is in the second half of this file.
"Dragon" = the contractor using the app. "Unicorn" = the contractor's customer.

## Landing page

- Default language must be Spanish. The toggle at the top should read "Yo hablo Espanol | I speak English", with "Yo hablo Espanol" selected by default. [p2]
- Footer contact info should be email `hello@paperworkmonster.com` and phone `866-767-8399`. (Screenshot: the "Questions about your project?" footer currently shows the contractor's own phone and gmail.) [p24]
- What is the difference between "Just give me a quick quote" and "I know my price, write it up"? [p25]

## My Assistant → "I know my price, write it up"

- Both the "Write it myself" box and the "Ex: Customer wants a 10x10…" placeholder appear. What is the difference? We don't need both. [p3]
- The AI must never echo the user's raw input back as the suggested description. (Screenshot: all three "I Need To" options just repeat "I need to replace a toile for $500".) We are the ones professionalizing the quotes. Claude and ChatGPT get this right every time. Until this is solved we cannot produce even simple quotes and invoices. [p4]
- Make sure the "From" block includes email and website when the Dragon has provided them. (Screenshot shows only name and phone.) [p5]

## My Assistant → "I know the job, help me price it"

- Again shows both "Write it myself" and the "Ex: Customer wants…" placeholder. We don't need both. [p6]
- The price tiers cannot be "Basic / Standard / Premium" with descriptions like "Basic paint job with minimal prep". That sounds terrible, like you'll do shit work for less money. Use the structure we settled on earlier (names may have changed): [p7]
  - **Competitive** — price-conscious bid when the job is straightforward and winning the work is the priority.
  - **Market** — typical professional price for this type of work in your area.
  - **Premium** — appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity.
- When calculating the price, are you using the Dragon's zip code? [p7]
- The Quote + Agreement card shows a "SENT" badge in the top right before I have actually sent it. [p8]
- Confirm the "Confirm your job details" page is working correctly. (Screenshot: the three options are the raw text verbatim; "Wider scope" only adds "Jobsite cleanup".) [p20]
- Price comparison for the same scope (2,000 sq ft house, two coats, baseboard and crown molding, 12 door jambs, 15 windows, all ceilings): PM offered $3,000 / $4,500 / $6,000; Claude estimated roughly $7,500–$11,600; ChatGPT estimated $6,500–$16,000. For PM I don't know whether that includes materials. That is a vital question. [p21]

## My Assistant → "Job's done, need invoice"

- On the landing page we do not say "Write it myself". Go through the same prompt as "I know my price, write it up". The invoice needs all the same terms as a quote, and that process is already built. [p9]
- If you select the invoice of an existing client, the next page must show what they paid, what they owe, the terms, etc. Drafting a brand-new invoice that is not from a quote can keep the current screen, but selecting an existing quote must go down that path. [p10]
- If I select an existing quote it should already know who the customer is. (Screenshot: it asks "What's the price?" again.) [p11]
- This entire process is really bad. It is not different from the quote. We need to preview it, edit it, provide all the relevant information, etc. [p12]
- The chip at the bottom reads "I know the job, help me price it.Write it myself". Needs a space after the period and a period at the end of "myself". [p26]
- This is a different prompt path and structure from the quote. It should be the same: if there is no quote to select, go through the same questions as the quote (skip how long it took, but ask for the completion date). Right now there is no preview, just "Invoice ready 🎉 … Send it now". That is not what we want. [p27]

## Quote flow: steps, back button, customers

- Fix the Go Back button for all of the tasks. Job Details is not editable on the review card, so they need a back button. [p13]
- Back button fails after you enter the price and go to the customer step. Hitting back takes you to the dashboard. [p31]
- The new-customer name field placeholder says "Yam". [p14]
- I created a new customer ("Incredible Hulk", business "Green Machine") and it did not save. [p15]
- "When does the job start?" has a "Job Completed" option. Remove it and put "Pick a date" in its place. Change "Next Month" to "Next month". [p22]
- Change "Job Completed" to "Job completed" (lowercase c). [p23]

## Sending, signing, and the customer link

- On "send": the email went out but the text failed with Twilio 400, error 21211 "Invalid 'To' Phone Number: +1555555XXXX". Assume it is just because I used a fake cell number. I did receive the quote via email. [p16]
- From the emailed link I filled in the "Ask a question" box at the bottom of the quote ("Question sent — your contractor will follow up directly"), but I never received the question. Where does it go? [p17]
- How do you mark an invoice paid? We are not taking payments, so the client has to tell us payment has been received. (Screenshot: the "Out for payment" invoice detail only offers Discount, Change order, View invoice, Open, Mute.) [p18]
- 04 SIGN HERE: "By signing below, Thing agrees to everything above." (currently "agree"). Contractor box: "CONTRACTOR SIGNATURE", business name (HANS LLC), the signature, "By: Hans Pedersen", "Date: May 23, 2026". Customer box: "YOUR SIGNATURE — Sign & type name below". Everything else the same. (The Spanish signed view already has this layout.) [p19]

## Invoices tab

- When an invoice is paid it must also be emailed to the Unicorn with "Paid" on it so everyone is on the same page. [p28]
- There is no real way to tell invoices apart other than customer name and price. There is a lot of wasted space that could show the job description. [p28]
- Double-check every invoice stage and what you can do in it: [p28]
  - **Awaiting confirmation** — has an "Ok I got it" button, but also needs a nudge button, because "Ok I got it" marks it as paid.
  - **Out for payment** — has no way to say payment received. Needs a "payment received" option, then you pick how it was paid from the payment options.
  - **Upcoming** — needs a "send it later" button with a date picker (if there is no start date, how do they know when to send the invoice?). Or a reminder text and email to the Dragon to approve that the job is done and send the final invoice.

## Payments

- If the Dragon marks an invoice as paid it should show up here. This is how payments are recorded. [p29]
- "Record a payment" takes you to the quote/invoice chat. What is that button for? [p29]

## Customers

- Format phone numbers as (555) 123-4567 as they are typed. That is sexy. [p30]
- You can create customers from the Customers page but not from My Assistant, yet the new-customer input shows up in the My Assistant dropdown. [p30]
- Customers tab: remove the "Who's on your books" chart (Property mgmt / Homeowners / Small biz / HOAs / Unsorted). We do not collect this data. [p32]

---

## After the "COMPLETED TASKS" divider (pp. 33–84)

Page 33 is a divider reading "COMPLETED TASKS". Only some pages after it are actually labeled COMPLETED. The unlabeled ones are listed first, as written.

### Not labeled completed

- **Pricing** [p34]
  - No Free tier.
  - Get rid of the % for now.
  - Starter package at $15 per month: "We can legitimize your business for less than a Netflix no-ad subscription", quotes etc.
  - $99 and $199 tiers.
- "We need to build out the Just give me a quick quote" with "REMOVE THIS." written over it. [p35]
- Sidebar collapse: the arrow between HANS LLC and Settings that minimizes the sidebar should work like QuickBooks, showing the hamburger plus an arrow to minimize. Use the same pattern for the PM Assistant conversations panel and remove the existing button. [p36]
- Add a business name on the Wizard. [p37]
- Job details bullets: very cool addition, but it needs a "Professionalize that" button (or similar) when you add a bullet. Right now it takes exactly what I typed. It should break it down, make it professional, and let the person accept or edit it. [p38]
- **Invoice edits** [p39]
  - Build the invoice with all the same information as the quote, except the 1–14 items under Terms and no signature block. Maybe include a link to the signed quote if one exists.
  - Make it editable.
  - Add change orders. A change order must trigger an approval to the Unicorn.
- **Overall tasks** [p40]
  - "My Assistant" needs to be at the top of the dashboard. On mobile you have to open the hamburger to find it, and My Assistant is everything.
  - After quotes and signed quotes, send a completion text and email.
  - Make it mobile-friendly.
  - PM Assistant: the hamburger menu icon does not work.
  - Settings: make the rest editable — mailing address, insurance upload, tax W-9.
  - There is no back button for the steps. Needs a back button throughout so they can easily be edited.
  - "Job Name" must be consistent across the platform. Summarize the job details into a name of three words or less.
- Quote badge: "Draft", then "Sent" once sent, then "Viewed", then "Approved" once they sign. Refer to "Quote & Agreement - Preview.docx" for the updates. [p41]
- "Copy link" from the quote detail is not the full quote, just a simple version of it. [p42]
- Refer to the doc "Quote & Agreement - Final.docx". [p43]
- The email: remove the quotation marks from the subject. I meant it should say that particular thing, not literally keep the quotes. (Screenshot also shows the contractor name rendered as "I" / "I know the job" / "I from help me price it." — the flow label is being used as the sender name.) [p44]
- Text-message template to the customer: [p45]
  > Hi [Customer Name], this is [Contractor Name] from [Business Name].
  > Your Quote + Agreement for [Job Name] is ready:
  > [LINK]
  > Please let me know if you have any questions. I look forward to working with you!
- Build out "I know the job, help me price it": [p46]
  - First screen is Job Details, then ask any questions needed.
  - Next screen confirms the details.
  - Then three pricing options plus a fourth custom one so they can choose.
  - Then the rest of the steps.
- Invoices: this is not working. We just need to adjust invoices through a discount or a change order. A change order triggers a new link so the Unicorn can approve. [p47]
- **Additional stuff** [p48]
  - Flawless mobile view with the same perfect UX translated to small screens.
  - Login button on the landing page, top of view, that takes you to a clean login component with the same login flow.
  - L10n Spanish translation: Mexican, South American, and Latino dialects.
  - (This page also contains a stray sales-call script, "HEYYY… John!! It's Ashley from Monster…", which looks pasted by accident.)
- Delete scope: do not delete data, flag it as "deleted". When someone signs up with the same phone number, offer to create a new account or recover the old one. [p58]
- **Overall tasks** [p60]
  - After picking one of the three initial options, the next thing for all three is the "Job Details" question. For at least the "I know my price" flow the input bar is then hidden.
  - Once a structured flow starts (have a price, have job details, or simple quote), hide the bottom input field after the job description or any required question is answered. If they are tapping options there should be no input field.
  - Update the logo.
  - "Paperwork Monsters" → "Paperwork Monster" (drop the s).
  - Starting a new conversation with "have price, need job details" should auto-focus the input.
  - Pricing: auto-focus the number field, and pressing Enter on the price should click Continue.
  - ***We need a Quote and Agreement change.
- Quote sent from the link: rename "fine print, in plain english" to "Terms and Conditions" and include the items from the previous slide and from slide 13. The contractor signature should carry the contractor's name. [p62]
- **Job Quote & Agreement layout** [p63]
  - Invoice number. Job Details (e.g. "Kitchen backsplash tile install 30 sq ft, porcelain tile"; Start: ASAP; Time to complete: 2–3 days). Payment (Total $1,200: $600 to start, $600 when the job is done). Warranty (6-month workmanship warranty). Cancelation (either side can cancel with 7-day notice; work completed will be paid for).
  - At the bottom, an expandable "Terms & Conditions" containing all the required notices from slide 13.
  - The quote has a pencil and is editable.
  - "Send to client" opens "How do you want to send to customer?" with Text / Email / Text + Email and Keep / Cancel.
- The new Quote/Contract is both. We do not need to send a separate contract. Keep the ability to draft contracts, but most people will send one legally binding quote with all the job details. [p81]
- **Agreement header edits** [p82]
  - The job name goes between Contractor name and Client.
  - "New Job" → "Godzilla's Concrete Patio Agreement".
  - "Between Paperwork Monster and Godzilla effective May 7, 2026".
  - "The Deal in Plain English" → "Quick Summary".
  - "Contract for new job" → should be the job name (we have no job details at that point).
- **Stretch goals**: look at competitors, add their best features, and easy import. [p84]

### Labeled COMPLETED

- Payment methods: Venmo, CashApp, Zelle, PayPal, Check, Cash. For handles, an input "here is my handle" with re-type to confirm. [p49]
- Fix the logo upload button (error at the bottom of the screenshot: "POST /files failed: 500"). [p50]
- Invoice: he just needs to send an invoice. Clients need a business name (done on the Clients screen; the wizard still lacked it). [p51]
- New "Job done need to invoice" button. [p52]
- "Job Completed" button. [p53–54]
- "Due Now" button. [p55]
- Make the Toilet Replacement job editable. [p56]
- Remove all the Excel sub-headers and the "in plain English" sub-header. 02 Payment Schedule and 03 Terms stay the same, updated to match the Dragon's quote-preview comments. Fine print includes only items 1–14. [p57]
- Job Details options: header "Pick the closest job description below and make any changes you want." Three clickable options generated from the description, each bullet with an "x" to delete (and restore), plus a final input bullet for the Dragon's own text. [p59]
- 04 Sign Here: "By signing below, you agree to everything above." "Contractor Signature" not "Contractor Signed". Footer: "Questions before signing? Call 540-333-1334 or email hp@hans.work! I look forward to working with you." [p61]
- Delete the "select review" step. Go straight to Review. [p64]
- New Conversation copy: "Your PM Assistant is here to help! Click on a box or the text field below to get started!" with the three options and "Not sure? Just tell me about the job." [p65]
- New Job screen: Scope of Work, Price, Add more details (optional), Talk or type, Start Quote / Edit Job. [p66]
- "What's the price? I'll build the job details around it." Work on the zeros. [p67]
- Kill Step 1 (past-jobs template: Home Job / Business Job / Start from scratch). [p68]
- Step 2: Pick a Customer. Dropdown of existing customers plus "+ New Customer" (Name, Phone, Email optional). [p69–70]
- Step 3: When does the job start? Right away / Next week / Next Month / Pick a date (calendar). [p71]
- Step 4: How long will the job take? 1 day / 2–3 days / 1 week / 2 weeks / Custom (opens in chat). Custom buttons consistent with the other steps. [p72–73]
- Step 5: When do you want to get paid? On completion / 50/50 / 30/30/40 / Deposit + balance / Custom (same as Payments). [p74–75]
- Step 6: Warranty. No warranty / 6 months / 1 year / 2 years / Custom. [p76–77]
- Step 7: Cancellation notice. Eliminate the choice and just use 7 days. [p78]
- Kill the dispute-venue step. Keep "Small claims / local court" in the contract text only. [p79]
- Remove the governing-law step. Fixed language: "This agreement is governed by the laws of the state where the work is performed, without regard to conflict of law rules." [p80]
- Replace the long legal section with the required notices only: Governing Law, Scope of Work, Payment Terms, Change Orders, Customer Responsibilities, Delays and Unforeseen Conditions, Warranty, Limitation of Liability, Right to Stop Work, Termination, Dispute Resolution, Permits and Compliance, Indemnification, Entire Agreement. [p83]
