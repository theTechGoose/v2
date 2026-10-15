/**
 * REQ-043 / REQ-065 — the legal documents the legal pages render, verbatim
 * from the client's October 6, 2026 document ("DocuMonster_Legal_Policies_
 * READY_TO_POST_October_6_2026.docx", Hans Pedersen, 2026-10-05): the Terms
 * of Service, the Refund & Cancellation Policy, the Privacy Policy and the
 * SMS Terms & Conditions. Pure data, no imports, so the jest unit test and
 * the Fresh routes read the same source. Generated from the document's
 * paragraphs; the Terms and the Refund Policy keep two closing paragraphs
 * because the document does.
 */

export type LegalBlock =
  | { kind: "p"; text: string }
  /** A run of bullet points ("You may not use the Services to: …"). */
  | { kind: "list"; items: readonly string[] }
  /** A bold run-in label followed by its paragraph (Privacy §1, §6). */
  | { kind: "labeled"; label: string; text: string };

export interface LegalSection {
  readonly n: number;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

/** The four documents, each its own page (REQ-066). */
export type LegalDocId = "terms" | "refunds" | "privacy" | "sms";

export interface LegalDoc {
  readonly id: LegalDocId;
  readonly title: string;
  readonly lastUpdated: string;
  /** All-caps standalone notice printed under the date. */
  readonly notice?: string;
  readonly intro: readonly string[];
  readonly sections: readonly LegalSection[];
}

export const LEGAL_LAST_UPDATED = "October 6, 2026";

const p = (text: string): LegalBlock => ({ kind: "p", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });
const labeled = (label: string, text: string): LegalBlock => ({
  kind: "labeled",
  label,
  text,
});

export const TERMS_OF_SERVICE: LegalDoc = {
  id: "terms",
  title: "Terms of Service",
  lastUpdated: LEGAL_LAST_UPDATED,
  notice:
    "THIS AGREEMENT IS SUBJECT TO ARBITRATION PURSUANT TO THE SOUTH CAROLINA UNIFORM ARBITRATION ACT.",
  intro: [
    'These Terms of Service ("Terms") constitute a legally binding agreement between you and Paperwork Monster Inc., doing business as DocuMonster Powered by Paperwork Monster ("DocuMonster," "we," "us," or "our"), governing your access to and use of our websites, applications, software, communications tools, artificial-intelligence-enabled features, and related products and services (collectively, the "Services").',
    "By creating an account, purchasing a subscription, checking a box indicating acceptance, or otherwise accessing or using the Services, you agree to be bound by these Terms, our Refund & Cancellation Policy, and our Privacy Policy. If you do not agree, do not access or use the Services.",
  ],
  sections: [
    {
      n: 1,
      heading: "Business-to-Business Service",
      blocks: [
        p(
          "DocuMonster provides software and related services intended to help businesses manage aspects of their operations, which may include customers, leads, projects, estimates, quotes, invoices, documents, communications, workflows, business records, reporting, and other administrative functions.",
        ),
        p(
          'The Services are intended for business and professional use and not for personal, family, or household use. You represent that you are at least 18 years old and have authority to enter into these Terms personally or on behalf of the business or organization you represent. If you use the Services on behalf of an entity, "you" and "Customer" include that entity.',
        ),
      ],
    },
    {
      n: 2,
      heading: "Accounts and Authorized Users",
      blocks: [
        p(
          "You must provide accurate and current information when creating an account and keep that information reasonably updated. You are responsible for maintaining the confidentiality of account credentials, activity occurring through your account, establishing appropriate permissions for employees and other authorized users, promptly notifying us of suspected unauthorized access, and ensuring that your authorized users comply with these Terms.",
        ),
        p(
          "You may not share credentials in a manner designed to circumvent subscription limits, user-seat requirements, or access controls.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Services and Features",
      blocks: [
        p(
          "The features available to you depend on your subscription plan, account configuration, and any additional services you purchase. DocuMonster may add, modify, improve, discontinue, or replace features from time to time. We will use commercially reasonable efforts to avoid materially reducing the core functionality of a paid subscription during an existing prepaid subscription period.",
        ),
        p(
          "Certain features may be identified as beta, preview, experimental, or early-access features. Such features may be changed or discontinued at any time and may be less reliable than generally available features.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Monster Free and Free Trials",
      blocks: [
        p(
          "DocuMonster may offer a free subscription tier currently known as Monster Free. Monster Free is intended to remain available without a subscription fee, subject to the features, usage limits, storage limits, communications limits, and other restrictions disclosed for that plan. DocuMonster may change the features or limits of a free plan prospectively.",
        ),
        p(
          "DocuMonster may also offer free trials of paid subscription plans, including trials lasting up to 30 days or another period disclosed at signup. The terms presented with a particular trial control that trial.",
        ),
        p(
          "If a trial requires a payment method and is disclosed as automatically converting to a paid subscription, the paid subscription will begin and the payment method may be charged when the trial ends unless you cancel before the disclosed deadline. Pricing and renewal information will be disclosed before a paid charge is initiated.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Subscriptions and Automatic Renewal",
      blocks: [
        p(
          "Paid subscriptions may be offered on a monthly, annual, or other disclosed billing cycle. Unless otherwise stated at purchase, monthly subscriptions automatically renew each month, annual subscriptions automatically renew each year, and applicable subscription fees are charged in advance for the upcoming subscription period.",
        ),
        p(
          "By purchasing a recurring subscription, you authorize DocuMonster and its payment-processing or merchant-service providers to charge your selected payment method for applicable subscription fees, taxes, and other charges that you authorize. Your subscription continues until canceled in accordance with these Terms and the Refund & Cancellation Policy.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Fees and Payment",
      blocks: [
        p(
          "You agree to pay all fees disclosed to you when purchasing or using paid Services. Payments may be processed by third-party payment processors or merchant-service providers. DocuMonster may receive payment-related information from those providers but may not directly receive or store complete payment-card credentials.",
        ),
        p(
          "You are responsible for maintaining a valid payment method. If payment cannot be completed, we may retry the charge, request another payment method, restrict paid functionality, suspend the account, or terminate paid Services. You remain responsible for amounts properly incurred before suspension or termination.",
        ),
      ],
    },
    {
      n: 7,
      heading: "Pricing Changes",
      blocks: [
        p(
          "DocuMonster may modify subscription prices or pricing structures from time to time. Unless otherwise disclosed or required by law, a price change affecting an existing paid subscription will apply prospectively at a future renewal and not retroactively to a subscription period that has already been paid. We will provide reasonable notice of material pricing changes before they become effective for an existing subscription. If you do not wish to continue at the new price, you may cancel before the applicable renewal date.",
        ),
      ],
    },
    {
      n: 8,
      heading: "Cancellation and Refunds",
      blocks: [
        p(
          "You may cancel a paid subscription at any time through the available account-management process or by contacting us through an authorized support channel. Unless otherwise expressly stated, cancellation becomes effective at the end of the current paid subscription period, you retain access to applicable paid Services through the end of that period, and cancellation prevents the next automatic renewal.",
        ),
        p(
          "Subscription payments are generally non-refundable, unused portions of monthly or annual subscription periods are not prorated or refunded, and annual subscription fees are generally non-refundable after purchase, except where otherwise expressly stated or required by law. DocuMonster may issue refunds, credits, or billing adjustments in its discretion for billing errors, duplicate charges, service issues, or exceptional circumstances. Additional details appear in our Refund & Cancellation Policy, which is incorporated into these Terms.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Customer Data",
      blocks: [
        p(
          'As between you and DocuMonster, you retain ownership of information, records, documents, images, customer information, estimates, invoices, project information, and other content that you or your authorized users submit to the Services ("Customer Data").',
        ),
        p(
          "You grant DocuMonster a non-exclusive, worldwide license to host, store, reproduce, process, transmit, display, analyze, and otherwise use Customer Data as reasonably necessary to provide and secure the Services, perform actions you request, support your account, maintain and improve the Services, detect fraud, abuse, or security threats, comply with law, and fulfill the purposes described in our Privacy Policy.",
        ),
        p(
          "You represent that you have the necessary rights and permissions to provide Customer Data to us and to direct us to process it.",
        ),
      ],
    },
    {
      n: 10,
      heading:
        "Information About Your Customers, Employees, and Other Contacts",
      blocks: [
        p(
          "The Services may allow you to store or process information concerning your customers, prospective customers, employees, subcontractors, vendors, and other third parties. You are responsible for determining whether you have a lawful basis and all necessary notices, permissions, authorizations, or consents to collect, upload, store, use, and communicate using that information. DocuMonster acts as a technology provider and does not independently establish the business relationship between you and your customers.",
        ),
      ],
    },
    {
      n: 11,
      heading: "Text Messages, Calls, Emails, and Customer Communications",
      blocks: [
        p(
          "The Services may allow you to communicate with customers, prospective customers, employees, vendors, or others by SMS or MMS text message, telephone, email, or other communication channels. When you initiate, schedule, authorize, or configure a communication through the Services, you are responsible for that communication and for having a lawful basis to send it, except where DocuMonster separately communicates in its own capacity.",
        ),
        p(
          "You must obtain and maintain any consent or authorization required by applicable law, honor opt-out and revocation requests, and comply with applicable law, carrier rules, and messaging-provider requirements. Additional rules governing SMS communications are set out in our SMS Terms & Conditions, which are incorporated into these Terms by reference.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Customer Contracts, Quotes, Estimates, and Invoices",
      blocks: [
        p(
          "The Services may allow you to create or deliver quotes, estimates, proposals, invoices, contracts, acknowledgments, or related documents. DocuMonster is not a party to agreements between you and your customers merely because those agreements or documents are created, delivered, approved, signed, or stored using the Services.",
        ),
        p(
          "You are responsible for determining the appropriate terms for your work, including pricing, scope, deposits, payment requirements, warranties, cancellation rights, licensing disclosures, consumer notices, construction-contract requirements, and other terms applicable to your business. Templates, sample provisions, automated suggestions, or other information made available through the Services are provided for convenience and do not constitute legal advice.",
        ),
      ],
    },
    {
      n: 13,
      heading: "Artificial Intelligence and Automated Features",
      blocks: [
        p(
          "Some Services may use artificial intelligence, machine learning, automated processing, or similar technologies. AI-enabled features may assist with drafting, summarization, recommendations, data organization, estimates, descriptions, calculations, communications, or other business functions.",
        ),
        p(
          "AI-generated or automated outputs may be incomplete, inaccurate, inappropriate, or unsuitable for your circumstances. You are responsible for reviewing outputs before relying on, sending, publishing, or using them. DocuMonster does not represent that AI-generated information constitutes legal, accounting, tax, engineering, financial, employment, insurance, construction, licensing, or other professional advice. You remain responsible for decisions made using the Services.",
        ),
      ],
    },
    {
      n: 14,
      heading: "Sensitive Business Documents",
      blocks: [
        p(
          "If enabled, the Services may permit customers to upload business documents such as insurance certificates, tax forms, W-9 forms, taxpayer identification information, licenses, permits, or similar business records. You should upload such information only when reasonably necessary for legitimate business purposes and only if you have authority to do so. DocuMonster may apply additional restrictions or security requirements to sensitive-document features.",
        ),
      ],
    },
    {
      n: 15,
      heading: "Acceptable Use",
      blocks: [
        p(
          "You may not use the Services to:",
        ),
        list(
          "violate applicable law or regulation;",
          "infringe intellectual-property, privacy, publicity, or other rights;",
          "send spam, unlawful communications, or communications for which required consent has not been obtained;",
          "engage in fraud, impersonation, or deceptive activity;",
          "distribute malware or malicious code;",
          "interfere with the security or operation of the Services;",
          "attempt unauthorized access to systems or accounts;",
          "scrape or extract information except through functionality we expressly provide;",
          "reverse engineer or attempt to derive source code except where such restriction is prohibited by law;",
          "circumvent subscription, usage, security, or access controls;",
          "use the Services to facilitate unlawful discrimination, harassment, threats, or abuse; or",
          "use the Services in a way that creates unreasonable risk to DocuMonster, its service providers, customers, or third parties.",
        ),
      ],
    },
    {
      n: 16,
      heading: "Our Intellectual Property",
      blocks: [
        p(
          "DocuMonster and its licensors retain all rights in and to the Services, including software, interfaces, designs, workflows, trademarks, logos, documentation, databases, technology, and other proprietary materials, excluding Customer Data. Subject to these Terms and payment of applicable fees, DocuMonster grants you a limited, non-exclusive, non-transferable, revocable right to access and use the Services for your internal business purposes during the applicable subscription period. No ownership rights are transferred to you.",
        ),
      ],
    },
    {
      n: 17,
      heading: "Feedback",
      blocks: [
        p(
          "If you provide suggestions, ideas, feature requests, or feedback regarding the Services, you permit DocuMonster to use that feedback without restriction or compensation to you, provided that this does not transfer ownership of your Customer Data.",
        ),
      ],
    },
    {
      n: 18,
      heading: "Third-Party Services",
      blocks: [
        p(
          "The Services may integrate with or rely upon third-party services, including communications providers, payment processors, hosting companies, analytics providers, artificial-intelligence providers, accounting platforms, telecommunications providers, and other technology vendors. Third-party services may be governed by separate terms and privacy policies. DocuMonster is not responsible for third-party services that are outside our reasonable control.",
        ),
      ],
    },
    {
      n: 19,
      heading: "Privacy and Security",
      blocks: [
        p(
          "Our collection, use, and disclosure of personal information are described in our Privacy Policy. We use reasonable administrative, technical, and organizational measures designed to protect information processed through the Services. No electronic system can be guaranteed to be completely secure, uninterrupted, or error-free, and we do not guarantee absolute security.",
        ),
      ],
    },
    {
      n: 20,
      heading: "Suspension and Termination",
      blocks: [
        p(
          "DocuMonster may suspend or terminate an account or particular functionality if we reasonably determine that payment is overdue; the account is being used fraudulently; use violates these Terms, applicable law, or third-party platform requirements; activity creates a security threat; activity could materially harm DocuMonster or others; or suspension is reasonably necessary to protect the integrity of the Services. Where reasonably practicable, we may provide notice and an opportunity to address the issue. Termination does not eliminate obligations or liabilities arising before termination.",
        ),
      ],
    },
    {
      n: 21,
      heading: "Data Following Cancellation",
      blocks: [
        p(
          "After termination or cancellation of a paid account, DocuMonster may make Customer Data available for export for up to 30 days, subject to account status, technical availability, legal requirements, and applicable product functionality. After that period, DocuMonster may delete, anonymize, archive, or otherwise dispose of Customer Data according to its retention practices and legal obligations. You are responsible for exporting information you wish to retain. We may retain information longer when required for legal, security, fraud-prevention, backup, accounting, dispute-resolution, or compliance purposes.",
        ),
      ],
    },
    {
      n: 22,
      heading: "Disclaimer of Warranties",
      blocks: [
        p(
          'TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE." PAPERWORK MONSTER DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, COMPLETELY SECURE, OR SUITABLE FOR EVERY BUSINESS PURPOSE.',
        ),
      ],
    },
    {
      n: 23,
      heading: "Limitation of Liability",
      blocks: [
        p(
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, PAPERWORK MONSTER AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AFFILIATES, CONTRACTORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST REVENUE, LOST BUSINESS, LOSS OF GOODWILL, OR LOSS OF DATA, ARISING OUT OF OR RELATING TO THE SERVICES OR THESE TERMS.",
        ),
        p(
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, PAPERWORK MONSTER'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SERVICES OR THESE TERMS WILL NOT EXCEED THE AMOUNT YOU PAID TO PAPERWORK MONSTER FOR THE SERVICES DURING THE TWELVE MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. NOTHING IN THESE TERMS EXCLUDES LIABILITY THAT CANNOT LAWFULLY BE EXCLUDED.",
        ),
      ],
    },
    {
      n: 24,
      heading: "Indemnification",
      blocks: [
        p(
          "To the extent permitted by law, you agree to defend, indemnify, and hold harmless DocuMonster and its officers, directors, employees, affiliates, and agents from third-party claims, damages, liabilities, penalties, judgments, and reasonable costs arising from or relating to your Customer Data; your violation of these Terms or applicable law; your products or services; your relationship or dispute with your customers; communications initiated or authorized through your account; your failure to obtain legally required communication consent; or infringement or violation of third-party rights caused by information or materials you provide.",
        ),
      ],
    },
    {
      n: 25,
      heading: "Governing Law",
      blocks: [
        p(
          "These Terms and disputes arising from them are governed by the laws of the State of South Carolina, without regard to conflict-of-law principles, except to the extent federal law applies.",
        ),
      ],
    },
    {
      n: 26,
      heading: "Informal Dispute Resolution",
      blocks: [
        p(
          "Before initiating arbitration, the party asserting a dispute must provide written notice describing the nature of the dispute and the requested resolution. The parties will make reasonable, good-faith efforts to resolve the dispute informally for at least 30 days after receipt of the notice before commencing arbitration.",
        ),
        p(
          "Notices to DocuMonster should be sent to: DocuMonster, 4505 Socastee Blvd, Myrtle Beach, SC 29588; email: hello@documonster.com.",
        ),
      ],
    },
    {
      n: 27,
      heading: "Binding Arbitration",
      blocks: [
        p(
          "Except as provided below, any dispute, claim, or controversy arising out of or relating to these Terms, the Services, or the relationship between you and DocuMonster that cannot be resolved through the informal process above will be resolved by final and binding arbitration on an individual basis.",
        ),
        p(
          'The arbitration will be administered by the American Arbitration Association ("AAA") under its applicable Commercial Arbitration Rules, unless another set of AAA rules is required by law. The arbitration may be conducted remotely unless the arbitrator determines that an in-person hearing is appropriate. Each party will be responsible for arbitration fees as provided by applicable AAA rules and law.',
        ),
        p(
          "The arbitrator may award any individual remedy available under applicable law but may not consolidate the claims of persons who are not parties to the arbitration unless both parties agree. Either party may pursue an individual claim in small claims court if the claim qualifies. Either party may also seek temporary or injunctive relief in a court of competent jurisdiction to protect intellectual property, confidential information, accounts, systems, or security while arbitration is pending.",
        ),
      ],
    },
    {
      n: 28,
      heading: "Class Action and Jury Trial Waiver",
      blocks: [
        p(
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW, YOU AND PAPERWORK MONSTER AGREE THAT DISPUTES WILL BE RESOLVED ONLY ON AN INDIVIDUAL BASIS AND NOT AS A CLASS, COLLECTIVE, CONSOLIDATED, OR REPRESENTATIVE ACTION. YOU AND PAPERWORK MONSTER EACH WAIVE THE RIGHT TO A TRIAL BY JURY FOR CLAIMS SUBJECT TO ARBITRATION.",
        ),
        p(
          "If the class-action waiver is determined to be unenforceable as to a particular claim or request for relief, that portion will be severed and handled as required by applicable law.",
        ),
      ],
    },
    {
      n: 29,
      heading: "Changes to These Terms",
      blocks: [
        p(
          "We may update these Terms from time to time. If we make material changes, we will provide reasonable notice through the Services, email, website, or another appropriate method. The updated Terms will identify their Last Updated date. Where applicable law requires affirmative acceptance of a change, we will request that acceptance.",
        ),
      ],
    },
    {
      n: 30,
      heading: "General Terms",
      blocks: [
        p(
          "These Terms, together with applicable order forms, the Refund & Cancellation Policy, Privacy Policy, and any additional terms expressly incorporated into them, constitute the agreement governing the Services. If one provision is unenforceable, the remaining provisions remain in effect to the maximum extent permitted by law. Our failure to enforce a provision is not a waiver.",
        ),
        p(
          "You may not assign these Terms without our consent except as part of a lawful transfer of substantially all of your business or assets, subject to applicable law. DocuMonster may assign these Terms in connection with a merger, acquisition, corporate reorganization, financing, or sale of assets. Provisions that by their nature should survive termination will survive, including provisions concerning payment obligations, ownership, disclaimers, limitations of liability, indemnification, dispute resolution, and arbitration.",
        ),
      ],
    },
    {
      n: 31,
      heading: "Contact Us",
      blocks: [
        p(
          "Questions concerning these Terms may be directed to: DocuMonster Inc., 4505 Socastee Blvd, Myrtle Beach, SC 29588, hello@documonster.com.",
        ),
        p(
          "Questions concerning these Terms may be directed to DocuMonster at hello@documonster.com, 855-DOCUMON (855-362-8666), or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Website: www.DocuMonster.com.",
        ),
      ],
    },
  ],
};

export const REFUND_POLICY: LegalDoc = {
  id: "refunds",
  title: "Refund & Cancellation Policy",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    'This Refund & Cancellation Policy applies to subscriptions and paid services purchased from Paperwork Monster Inc., doing business as DocuMonster Powered by Paperwork Monster ("DocuMonster," "we," "us," or "our"). This Policy forms part of our Terms of Service.',
  ],
  sections: [
    {
      n: 1,
      heading: "Recurring Subscriptions",
      blocks: [
        p(
          "DocuMonster may offer monthly, annual, or other recurring subscription plans. Unless otherwise stated when you purchase a plan, monthly subscriptions automatically renew monthly, annual subscriptions automatically renew annually, and subscription charges are billed in advance for the applicable subscription period. Your subscription remains active until canceled.",
        ),
      ],
    },
    {
      n: 2,
      heading: "Cancellation",
      blocks: [
        p(
          "You may cancel your paid subscription at any time through any cancellation functionality available within your account or by contacting DocuMonster through an authorized support channel. Cancellation prevents the subscription from renewing for another billing period. Unless otherwise stated, cancellation does not immediately terminate access to Services you have already paid for; you may continue using applicable paid features through the end of your current paid subscription period.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Monthly Plans",
      blocks: [
        p(
          "If you cancel a monthly subscription, cancellation becomes effective at the end of the monthly billing period for which payment has already been made. No additional monthly subscription charge will be made after cancellation becomes effective. We generally do not provide refunds or prorated credits for unused portions of a monthly billing period.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Annual Plans",
      blocks: [
        p(
          "Annual subscription fees are charged for the annual subscription period disclosed at purchase. If you cancel an annual subscription, cancellation ordinarily becomes effective at the end of the annual period already purchased. Annual subscription fees are generally non-refundable and are not prorated based on unused months or unused Services, except where required by law or expressly stated in a written offer. Your annual subscription will not renew after its cancellation becomes effective.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Free Plans",
      blocks: [
        p(
          "DocuMonster may offer a free subscription tier, including Monster Free. A free account does not incur a subscription charge unless you affirmatively upgrade to a paid plan or enroll in another paid service. Features and usage limits applicable to free plans may differ from paid plans and may change prospectively.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Free Trials",
      blocks: [
        p(
          "DocuMonster may offer free trials of paid subscription plans. Trial duration and conversion terms will be disclosed with the applicable offer. If a free trial is offered without requiring payment information, access to paid features may end or revert to a free plan when the trial expires unless you purchase a paid subscription. If a trial requires payment information and is disclosed as automatically converting to a paid subscription, you must cancel before the disclosed trial deadline to avoid the first paid subscription charge. Once a paid subscription charge is processed following a properly disclosed trial conversion, the ordinary refund provisions of this Policy apply.",
        ),
      ],
    },
    {
      n: 7,
      heading: "No Prorated Refunds",
      blocks: [
        p(
          "Except where required by law or expressly provided by DocuMonster, subscription fees are not refundable merely because you did not use the Services, used the Services less than expected, stopped using the Services before the subscription period ended, an employee or authorized user stopped using the account, your business circumstances changed, or you canceled after a subscription period had already begun.",
        ),
      ],
    },
    {
      n: 8,
      heading: "Billing Errors and Duplicate Charges",
      blocks: [
        p(
          "If you believe you were charged incorrectly, please contact DocuMonster promptly. If we confirm a billing error, duplicate charge, or unauthorized charge for which DocuMonster is responsible, we may reverse the charge, issue a refund, or apply an account credit as appropriate.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Discretionary Refunds and Credits",
      blocks: [
        p(
          "DocuMonster may, in its discretion, issue refunds or service credits in exceptional circumstances. Issuing a refund or credit in one situation does not create an obligation to provide the same remedy in another situation and does not modify this Policy.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Price Changes",
      blocks: [
        p(
          "We may change subscription prices prospectively. For existing subscriptions, a price change will ordinarily become effective at a future renewal rather than during a billing period that has already been paid. We will provide reasonable notice of a material price change affecting an existing subscription. You may cancel before renewal if you do not wish to continue at the new price.",
        ),
      ],
    },
    {
      n: 11,
      heading: "Suspension or Termination for Violation",
      blocks: [
        p(
          "If DocuMonster suspends or terminates an account because of nonpayment, fraud, unlawful activity, abuse, security concerns, violation of our Terms of Service, or similar misconduct, previously paid subscription fees are generally non-refundable. You remain responsible for legitimate charges incurred before termination.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Data After Cancellation",
      blocks: [
        p(
          "Following cancellation or termination, DocuMonster may make account data available for export for up to 30 days, subject to product functionality, account status, legal requirements, and technical availability. After that period, data may be deleted, anonymized, archived, or retained according to our data-retention practices and legal obligations. Customers are responsible for exporting information they wish to keep.",
        ),
      ],
    },
    {
      n: 13,
      heading: "How to Request Help With a Billing Issue",
      blocks: [
        p(
          "Questions regarding cancellation, subscription charges, refunds, or billing errors may be sent to DocuMonster Inc. at hello@documonster.com or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Please include enough information for us to identify the applicable account and transaction. Do not email complete payment-card numbers or other unnecessary sensitive payment information.",
        ),
        p(
          "Questions regarding cancellation, subscription charges, refunds, or billing errors may be sent to DocuMonster at hello@documonster.com, 855-DOCUMON (855-362-8666), or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Website: www.DocuMonster.com. Please include enough information for us to identify the applicable account and transaction. Do not email complete payment-card numbers or other unnecessary sensitive payment information.",
        ),
      ],
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  id: "privacy",
  title: "Privacy Policy",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    'This Privacy Policy explains how Paperwork Monster Inc., doing business as DocuMonster Powered by Paperwork Monster ("DocuMonster," "we," "us," or "our"), collects, uses, discloses, and protects information when individuals visit www.DocuMonster.com, create or use an account, interact with our Services, communicate with us, or otherwise interact with DocuMonster. Our Services are primarily designed for businesses.',
  ],
  sections: [
    {
      n: 1,
      heading: "Information We Collect",
      blocks: [
        labeled(
          "Account and Business Information",
          "We may collect name, business name, business address, email address, telephone number, job title or role, username and account credentials, account preferences, subscription plan, authorized-user information, and other information provided when establishing or managing an account.",
        ),
        labeled(
          "Billing and Transaction Information",
          "If you purchase paid Services, we and our payment-processing or merchant-service providers may collect information necessary to process the transaction, such as billing name and address, payment method type, transaction amount, transaction date, payment status, and identifiers associated with the transaction. Payment-card information may be handled directly by payment processors or merchant-service providers rather than stored directly by DocuMonster.",
        ),
        labeled(
          "Customer and CRM Information",
          "Customers may upload or enter information regarding their own customers, prospective customers, employees, subcontractors, vendors, jobs, or projects. This information may include names, telephone numbers, email addresses, service addresses, customer notes, appointment information, project information, estimates and quotes, invoices, photos, communications, transaction records, and other information the customer chooses to store through the Services. DocuMonster processes this information principally to provide Services to the applicable business customer.",
        ),
        labeled(
          "Business Documents",
          "If related functionality is enabled, customers may upload business documents such as certificates of insurance, licenses, permits, W-9 forms, taxpayer identification information, vendor records, or similar business documentation. We do not request Social Security numbers, driver's-license information, health information, biometric information, background-check information, or other highly sensitive personal information as part of our ordinary account-registration process unless a future feature specifically requires such information and appropriate disclosures are provided.",
        ),
        labeled(
          "Communications",
          "We may collect communications sent through or to DocuMonster, including support requests, emails, chat messages, telephone communications, text messages, customer feedback, and communications transmitted through platform functionality. Where permitted by law and appropriately disclosed, calls or other interactions with DocuMonster may be recorded or analyzed for quality assurance, security, support, training, or service improvement.",
        ),
        labeled(
          "Device and Usage Information",
          "When you use our websites or Services, we may automatically collect information such as IP address, browser type, device type, operating system, pages or features accessed, dates and times of access, referring pages, session information, error and diagnostic information, approximate location derived from IP address, and interactions with the Services. We may use cookies, pixels, software development kits, local storage, and similar technologies for authentication, security, analytics, preferences, performance, and marketing.",
        ),
      ],
    },
    {
      n: 2,
      heading: "How We Use Information",
      blocks: [
        p(
          "We may use information to:",
        ),
        list(
          "create and administer accounts;",
          "provide and operate the Services;",
          "authenticate users;",
          "process subscription payments;",
          "deliver requested communications;",
          "provide customer support;",
          "maintain customer and project records;",
          "generate estimates, invoices, documents, reports, or other requested outputs;",
          "provide AI-enabled and automated functionality;",
          "personalize and improve the Services;",
          "understand feature usage and performance;",
          "develop new features;",
          "maintain security;",
          "prevent fraud, spam, abuse, and unauthorized activity;",
          "troubleshoot technical issues;",
          "enforce our agreements;",
          "communicate about accounts, subscriptions, updates, and security;",
          "send marketing communications where permitted;",
          "comply with legal obligations; and",
          "establish, exercise, or defend legal claims.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Artificial Intelligence and Automated Processing",
      blocks: [
        p(
          "Certain features may use artificial intelligence, machine learning, or automated technologies. Information submitted to these features may be processed by DocuMonster or service providers supporting those technologies for purposes such as generating requested outputs, improving workflows, summarizing information, organizing information, or performing other requested functions. We may establish additional restrictions regarding information that may be submitted to AI-enabled features. Customers should not submit unnecessary sensitive personal information to AI features.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Information About Our Customers' Customers",
      blocks: [
        p(
          "Businesses using DocuMonster may provide us with personal information concerning their customers, prospective customers, employees, subcontractors, or other contacts. In many circumstances, DocuMonster processes this information on behalf of the business customer that entered the information into the Services. That business determines why the information is collected, which information is entered, and how it is used through its account.",
        ),
        p(
          "If you are a customer of a business that uses DocuMonster and you have questions about information that business maintains about you, you should generally contact that business directly. We may assist our business customers in responding to appropriate privacy requests.",
        ),
      ],
    },
    {
      n: 5,
      heading: "SMS, Mobile Information, Phone Calls, and Email",
      blocks: [
        p(
          "The Services may enable our business customers to communicate with their customers or other contacts by text message, telephone, and email. DocuMonster may process recipient information, consent records, and communication metadata as necessary to transmit, route, secure, troubleshoot, document, and support those communications.",
        ),
        p(
          "Mobile opt-in information and SMS consent are not sold, rented, released, or shared with third parties or affiliates for their own marketing or promotional purposes. We may provide such information to communications providers and other service providers only as reasonably necessary to deliver messages, operate and secure the Services, comply with law, prevent abuse, or carry out the instructions of the applicable business customer. DocuMonster does not use a business customer's customer list, mobile opt-in information, or SMS consent to market DocuMonster products or services to that business customer's contacts unless the individual separately establishes a direct relationship with DocuMonster and independently consents.",
        ),
        p(
          "Recipients may opt out of applicable text-message programs using the instructions provided with those messages, including replying STOP where supported. Opting out of promotional messages does not prevent legally permitted non-SMS communications or communications that are otherwise required to complete a transaction or provide requested support.",
        ),
      ],
    },
    {
      n: 6,
      heading: "How We Disclose Information",
      blocks: [
        labeled(
          "Service Providers",
          "We may use companies that provide services such as cloud hosting, communications infrastructure, telephone and SMS services, email delivery, payment processing, cybersecurity, analytics, customer support, artificial intelligence, software development, data storage, and professional services. These providers may process information as necessary to perform services for us and are not authorized by DocuMonster to use customer personal information for unrelated purposes.",
        ),
        labeled(
          "At Your Direction",
          "We may disclose information when you direct us to do so, including when you send an estimate or invoice, transmit a communication, share a document, activate an integration, or otherwise request that information be provided to another person or service.",
        ),
        labeled(
          "Business Transactions",
          "Information may be disclosed as part of an actual or contemplated merger, financing, acquisition, sale of assets, corporate reorganization, bankruptcy, or similar transaction, subject to appropriate confidentiality protections where applicable.",
        ),
        labeled(
          "Legal and Safety Purposes",
          "We may disclose information when we reasonably believe it is necessary to comply with applicable law, respond to valid legal process, protect the rights or property of DocuMonster or others, investigate fraud or unlawful conduct, address security threats, enforce our agreements, or protect the safety of individuals.",
        ),
      ],
    },
    {
      n: 7,
      heading: "We Do Not Sell Personal Information",
      blocks: [
        p(
          'DocuMonster does not sell personal information for monetary consideration and does not operate a business model in which customer contact information is sold to data brokers or unrelated third parties. Some privacy laws use broader definitions of "sale," "sharing," or targeted advertising. If our future practices constitute selling or sharing under an applicable privacy law, we will provide notices and choices required by that law.',
        ),
      ],
    },
    {
      n: 8,
      heading: "Marketing",
      blocks: [
        p(
          "We may use contact information collected directly by DocuMonster to communicate about DocuMonster products, features, promotions, educational materials, or events where permitted by law. We do not use a business customer's customer list or downstream customer contact information to market DocuMonster products or services to those individuals unless they separately establish a direct relationship with DocuMonster and independently consent. You may unsubscribe from promotional email communications using the unsubscribe link contained in those emails. Opting out of marketing does not prevent us from sending necessary transactional, security, billing, account, or service communications.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Cookies and Analytics",
      blocks: [
        p(
          "We may use cookies and similar technologies to maintain sessions, remember preferences, authenticate accounts, detect fraud, measure website traffic, understand product usage, improve performance, and evaluate marketing effectiveness. Browser controls may allow you to limit certain cookies, although disabling necessary cookies may affect functionality.",
        ),
        p(
          "Our marketing and sign-up pages use the Meta Pixel, a measurement tool provided by Meta Platforms, Inc., to measure the effectiveness of our advertising on Facebook and Instagram. The Meta Pixel may set cookies (such as _fbp) and shares limited event data with Meta — for example, that a page was viewed, that a verification code was requested, that an account was created, or that a plan was purchased — together with standard browser information. We do not send Meta your phone number, email address, or the contents of your documents. You can limit how Meta uses this information through your Facebook ad preferences, and browser controls may allow you to block these cookies.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Data Retention",
      blocks: [
        p(
          "We retain information for as long as reasonably necessary to provide Services and fulfill the purposes described in this Policy, including to satisfy legal, accounting, tax, security, fraud-prevention, dispute-resolution, and contractual obligations.",
        ),
        p(
          "Following cancellation or termination of an account, Customer Data may remain available for export for up to 30 days, subject to account status, technical availability, legal requirements, and applicable product functionality. After that period, information may be deleted, anonymized, archived, or retained where reasonably necessary for legitimate business or legal purposes. Information may persist temporarily in backups and disaster-recovery systems.",
        ),
      ],
    },
    {
      n: 11,
      heading: "Data Security",
      blocks: [
        p(
          "We use reasonable administrative, technical, and organizational safeguards designed to protect information against unauthorized access, loss, misuse, alteration, or disclosure. However, no method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security. Customers are responsible for maintaining appropriate password security and user-access controls for their accounts.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Your Privacy Choices",
      blocks: [
        p(
          "Depending on your relationship with DocuMonster and applicable law, you may have rights concerning personal information, which may include rights to request access, correction, deletion, or a copy of certain information; restrict or object to certain processing; withdraw consent where processing is based on consent; or opt out of certain uses of information. These rights are subject to applicable exceptions and verification requirements.",
        ),
        p(
          "If DocuMonster processes information solely on behalf of one of our business customers, we may direct your request to that customer. Requests may be submitted to hello@documonster.com. We may request information reasonably necessary to verify your identity or authority to submit a request.",
        ),
      ],
    },
    {
      n: 13,
      heading: "State Privacy Rights",
      blocks: [
        p(
          "Residents of certain U.S. states may have additional privacy rights under applicable state law. Where such laws apply to DocuMonster's processing, we will honor legally required rights, which may include access, correction, deletion, data portability, and rights concerning certain sales, sharing, or targeted advertising. We will not unlawfully discriminate against an individual for exercising an applicable privacy right. An authorized agent may submit a request where permitted by law and subject to appropriate verification.",
        ),
      ],
    },
    {
      n: 14,
      heading: "Children's Privacy",
      blocks: [
        p(
          "The Services are designed for businesses and are not intended for children under 18. We do not knowingly solicit children under 18 to create business accounts. If we learn that information has been collected from a child in circumstances where collection is prohibited, we will take appropriate steps to delete or otherwise address that information.",
        ),
      ],
    },
    {
      n: 15,
      heading: "International Users",
      blocks: [
        p(
          "DocuMonster operates primarily in the United States. If information is submitted from outside the United States, it may be processed and stored in the United States or other locations in which our service providers operate. Additional terms or disclosures may be provided if DocuMonster materially expands Services into jurisdictions with specific international privacy requirements.",
        ),
      ],
    },
    {
      n: 16,
      heading: "Third-Party Services and Integrations",
      blocks: [
        p(
          "The Services may contain integrations, links, or functionality supplied by third parties. Information you choose to send to a third-party service is also subject to that third party's privacy practices. DocuMonster is not responsible for independent privacy practices of third parties.",
        ),
      ],
    },
    {
      n: 17,
      heading: "Changes to This Privacy Policy",
      blocks: [
        p(
          "We may update this Privacy Policy from time to time. The revised Policy will identify its Last Updated date. If we make material changes, we may provide additional notice through our website, Services, email, or another appropriate communication method.",
        ),
      ],
    },
    {
      n: 18,
      heading: "Contact Us",
      blocks: [
        p(
          "For questions about this Privacy Policy or DocuMonster's privacy practices, contact DocuMonster at hello@documonster.com, 855-DOCUMON (855-362-8666), or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Website: www.DocuMonster.com.",
        ),
      ],
    },
  ],
};

export const SMS_TERMS: LegalDoc = {
  id: "sms",
  title: "SMS Terms & Conditions",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    'These SMS Terms & Conditions ("SMS Terms") describe the rules that apply to text messages sent by Paperwork Monster Inc., doing business as DocuMonster Powered by Paperwork Monster ("DocuMonster," "we," "us," or "our"), and to SMS functionality made available through our Services. These SMS Terms supplement our Terms of Service and Privacy Policy.',
  ],
  sections: [
    {
      n: 1,
      heading: "SMS Program Overview",
      blocks: [
        p(
          "DocuMonster may use SMS or MMS text messaging to communicate with its own business customers, users, leads, and other individuals who have provided appropriate consent. Our Services may also allow business customers to send text messages to their own customers, prospective customers, employees, vendors, or other contacts. When a business customer sends a message through the Services, that business customer is generally the sender and is responsible for the message content, consent, and compliance obligations.",
        ),
      ],
    },
    {
      n: 2,
      heading: "Consent for SMS Communications",
      blocks: [
        p(
          "Recurring or one-time text messages may be sent only where the recipient has provided the consent required for the applicable type of message. Providing a telephone number by itself does not authorize every type of SMS communication. Consent must be appropriate to the message type, the sender, and applicable law.",
        ),
        p(
          "Depending on the interaction and messaging program, consent may be obtained through an optional, unchecked online checkbox; a written or electronic agreement; a keyword or other affirmative opt-in; or verbal consent where legally permitted and appropriately documented. Promotional or marketing messages require the level of written consent required by applicable law and carrier rules. Consent to receive marketing text messages is not a condition of purchasing DocuMonster Services.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Types of SMS Communications",
      blocks: [
        p(
          "If you have consented to receive text messages, messages may include, as applicable:",
        ),
        list(
          "account, onboarding, verification, or support messages;",
          "appointment reminders and scheduling updates;",
          "quote, estimate, proposal, contract, invoice, payment, or billing notifications;",
          "project, service, delivery, or status updates;",
          "follow-up messages and responses to inquiries;",
          "security, fraud-prevention, or service-related notices; and",
          "promotional messages sent by the applicable business customer to its own contacts only where the required consent has been obtained.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Opt-In Methods",
      blocks: [
        p(
          "The available opt-in method may vary by messaging program. Where offered, a recipient may opt in by affirmatively checking an optional, unchecked consent box on a website or form, submitting written or electronic consent, replying with a designated keyword, initiating an eligible conversational exchange, or providing verbal consent where that method is legally permitted and properly documented. The disclosure presented at the time of opt-in controls the scope of the consent.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Message Frequency, Charges, STOP, and HELP",
      blocks: [
        p(
          "Message frequency varies based on the recipient's relationship with the sender, the features used, and the communications requested. Message and data rates may apply depending on the recipient's wireless plan and carrier.",
        ),
        p(
          "A recipient may opt out of an applicable SMS program at any time by replying STOP. After a valid STOP request is processed, no further messages should be sent through that messaging program unless the recipient later provides valid consent to resume messaging. For assistance, reply HELP where supported, call 855-DOCUMON (855-362-8666), or email hello@documonster.com.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Privacy of SMS Consent and Mobile Information",
      blocks: [
        p(
          "SMS consent and mobile opt-in information are not sold, rented, or shared with third parties or affiliates for their own marketing or promotional purposes. Information may be provided to communications providers and other service providers only as reasonably necessary to deliver messages, operate and secure the Services, comply with law, prevent abuse, or carry out the instructions of the applicable business customer. DocuMonster does not use a business customer's customer list or SMS consent to market DocuMonster products or services to that business customer's contacts unless the individual separately establishes a direct relationship with DocuMonster and independently consents. Additional information is available in our Privacy Policy.",
        ),
      ],
    },
    {
      n: 7,
      heading: "Business Customers Using DocuMonster Messaging",
      blocks: [
        p(
          "A business customer that uses DocuMonster to send text messages is responsible for obtaining and maintaining all consent required for its recipients, keeping appropriate evidence of that consent, using recipient information only for lawful purposes, and promptly honoring opt-out or revocation requests. Business customers may not use the Services to send unsolicited, deceptive, unlawful, abusive, or prohibited messages.",
        ),
        p(
          "If you receive a text message sent through DocuMonster on behalf of one of our business customers, that business customer is generally the sender. Questions about the underlying service, transaction, appointment, estimate, invoice, or marketing relationship should ordinarily be directed to that business.",
        ),
      ],
    },
    {
      n: 8,
      heading: "Delivery and Carrier Availability",
      blocks: [
        p(
          "Text-message delivery is subject to wireless-carrier availability, network conditions, device settings, and third-party communications providers. Delivery is not guaranteed, and DocuMonster is not responsible for delays or failures caused by circumstances outside our reasonable control.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Changes to These SMS Terms",
      blocks: [
        p(
          "We may update these SMS Terms from time to time. The revised version will identify its Last Updated date. Material changes may be communicated through our website, Services, email, text message, or another appropriate method where required.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Contact Us",
      blocks: [
        p(
          "Questions about these SMS Terms may be directed to DocuMonster at hello@documonster.com, 855-DOCUMON (855-362-8666), or 4505 Socastee Blvd, Myrtle Beach, SC 29588. Website: www.DocuMonster.com.",
        ),
      ],
    },
  ],
};

/** The four documents in Hans's order: the footer's order and the pages' row. */
export const LEGAL_DOCS: readonly LegalDoc[] = [
  TERMS_OF_SERVICE,
  REFUND_POLICY,
  PRIVACY_POLICY,
  SMS_TERMS,
];

/** REQ-066/067 — each document's page and its footer label (a dictionary
 *  key, `siteFooter.<id>`, so the label is the document's title in both
 *  languages). Every footer and the legal pages' own row render THIS list;
 *  nothing else spells a policy path. */
export interface LegalLink {
  readonly id: LegalDocId;
  readonly path: string;
  readonly labelKey: string;
}
/** REQ-067 — Hans's four policy links, in his order, each to its own page
 *  (REQ-066); every footer renders THIS list (REQ-076: broken out, never one
 *  link to a tabbed page — RingCentral's reviewer must land on the policy). */
export const LEGAL_LINKS: readonly LegalLink[] = [
  { id: "terms", path: "/terms", labelKey: "siteFooter.terms" },
  { id: "refunds", path: "/refund-policy", labelKey: "siteFooter.refunds" },
  { id: "privacy", path: "/privacy", labelKey: "siteFooter.privacy" },
  { id: "sms", path: "/sms-terms", labelKey: "siteFooter.sms" },
];

export function legalPathFor(id: LegalDocId): string {
  return LEGAL_LINKS.find((l) => l.id === id)!.path;
}

/** The Terms of Service page (REQ-043). */
export const TERMS_PATH = legalPathFor("terms");

/** REQ-043 amendment ("it should be both"): the documents in the visitor's
 *  language. Imports the Spanish module lazily-by-position (bottom of file) so
 *  the English data above stays import-free. */
import { LEGAL_DOCS_ES } from "./terms.es.ts";
export function legalDocsFor(lang: "en" | "es"): readonly LegalDoc[] {
  return lang === "es" ? LEGAL_DOCS_ES : LEGAL_DOCS;
}
export function legalDocFor(lang: "en" | "es", id: LegalDocId): LegalDoc {
  return legalDocsFor(lang).find((d) => d.id === id)!;
}
