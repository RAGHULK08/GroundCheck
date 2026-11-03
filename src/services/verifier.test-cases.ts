import type { ClaimStatus } from '../types/groundcheck';

/**
 * Labelled verification test cases (data only).
 *
 * Written against the default knowledge base (INITIAL_DOCS in storage.ts):
 *  - Refund Policy: full refund within 14 days of purchase if unused and in original
 *    packaging; processed within 5 to 7 business days; digital products and gift cards
 *    are non-refundable; contact support with the order number.
 *  - Shipping Policy: standard 3 to 5 business days, free above 999 rupees; express for
 *    an additional fee in 1 to 2 business days; international to select countries in
 *    7 to 14 business days; tracking emailed.
 *
 * Each `claim` is exactly one sentence (verifyResponse splits on sentence boundaries),
 * so avoid abbreviations like "Rs." that would split it.
 * Contradictions are expected as HALLUCINATED (ClaimStatus has no CONTRADICTED value).
 */

export type TestCaseCategory =
  | 'supported-paraphrase'
  | 'numeric-duration-contradiction'
  | 'currency-contradiction'
  | 'negation'
  | 'out-of-kb'
  | 'web-answerable';

export interface VerifierTestCase {
  id: string;
  prompt: string;
  claim: string;
  expected: ClaimStatus;
  category: TestCaseCategory;
  /** Run with web search. Defaults to false so KB-only categories are not affected by web noise. */
  enableWebSearch?: boolean;
  /** Why this label is correct, for reviewers. */
  note?: string;
}

export const TEST_CASE_CATEGORIES: readonly TestCaseCategory[] = [
  'supported-paraphrase',
  'numeric-duration-contradiction',
  'currency-contradiction',
  'negation',
  'out-of-kb',
  'web-answerable',
];

const REFUND_PROMPT = 'What is the refund policy?';
const SHIPPING_PROMPT = 'What are the shipping options and is shipping free?';
const IRCTC_PROMPT =
  'On IRCTC, if a confirmed passenger files a TDR after chart preparation, what happens to the waitlisted passenger on the same PNR?';

export const VERIFIER_TEST_CASES: readonly VerifierTestCase[] = [
  // ---- Supported paraphrase (4) ----
  {
    id: 'para-01',
    category: 'supported-paraphrase',
    prompt: REFUND_PROMPT,
    claim: 'Customers can get a full refund within two weeks of purchase if the item is unused and still in its original packaging.',
    expected: 'GROUNDED',
    note: '"two weeks" paraphrases 14 days; units differ so the quantity check does not compare them.',
  },
  {
    id: 'para-02',
    category: 'supported-paraphrase',
    prompt: REFUND_PROMPT,
    claim: 'Once the returned item has been received, the refund is processed in 5 to 7 business days.',
    expected: 'GROUNDED',
  },
  {
    id: 'para-03',
    category: 'supported-paraphrase',
    prompt: SHIPPING_PROMPT,
    claim: 'Standard shipping is free for orders above 999 rupees.',
    expected: 'GROUNDED',
  },
  {
    id: 'para-04',
    category: 'supported-paraphrase',
    prompt: SHIPPING_PROMPT,
    claim: 'For an extra fee, express shipping delivers within 1 to 2 business days.',
    expected: 'GROUNDED',
  },

  // ---- Numeric duration contradiction (3) ----
  {
    id: 'dur-15',
    category: 'numeric-duration-contradiction',
    prompt: REFUND_PROMPT,
    claim: 'Customers can request a full refund within 15 days of purchase.',
    expected: 'HALLUCINATED',
    note: 'KB says 14 days.',
  },
  {
    id: 'dur-13',
    category: 'numeric-duration-contradiction',
    prompt: REFUND_PROMPT,
    claim: 'Customers can request a full refund within 13 days of purchase.',
    expected: 'HALLUCINATED',
    note: 'KB says 14 days; 13 is a near miss that NLI may read as compatible.',
  },
  {
    id: 'dur-30',
    category: 'numeric-duration-contradiction',
    prompt: REFUND_PROMPT,
    claim: 'Customers can request a full refund within 30 days of purchase.',
    expected: 'HALLUCINATED',
    note: 'KB says 14 days.',
  },

  // ---- Currency contradiction (2) ----
  {
    id: 'cur-1000',
    category: 'currency-contradiction',
    prompt: SHIPPING_PROMPT,
    claim: 'Standard shipping is free on orders above 1000 rupees.',
    expected: 'HALLUCINATED',
    note: 'KB says 999 rupees.',
  },
  {
    id: 'cur-1000-symbol',
    category: 'currency-contradiction',
    prompt: SHIPPING_PROMPT,
    claim: 'Free standard shipping applies only to orders above ₹1,000.',
    expected: 'HALLUCINATED',
    note: 'KB says 999 rupees; tests the ₹ prefix and thousands separator.',
  },

  // ---- Negation (3) ----
  {
    id: 'neg-giftcards-refundable',
    category: 'negation',
    prompt: REFUND_PROMPT,
    claim: 'Gift cards and digital products are refundable upon request.',
    expected: 'HALLUCINATED',
    note: 'KB says they are non-refundable; must be caught by NLI contradiction.',
  },
  {
    id: 'neg-digital-cannot',
    category: 'negation',
    prompt: REFUND_PROMPT,
    claim: 'Digital products cannot be refunded.',
    expected: 'GROUNDED',
  },
  {
    id: 'neg-express-not-free',
    category: 'negation',
    prompt: SHIPPING_PROMPT,
    claim: 'Express shipping is not free of charge.',
    expected: 'GROUNDED',
    note: 'KB: express shipping costs an additional fee.',
  },

  // ---- Out of KB (4), KB only ----
  {
    id: 'oob-irctc-auto-tdr',
    category: 'out-of-kb',
    prompt: IRCTC_PROMPT,
    claim: 'IRCTC automatically applies the confirmed passenger’s TDR refund to the waitlisted passenger on the same PNR.',
    expected: 'UNVERIFIABLE',
  },
  {
    id: 'oob-irctc-separate-tdr',
    category: 'out-of-kb',
    prompt: IRCTC_PROMPT,
    claim: 'The waitlisted passenger on the same PNR must file a separate TDR to receive a refund after chart preparation.',
    expected: 'UNVERIFIABLE',
  },
  {
    id: 'oob-tokyo',
    category: 'out-of-kb',
    prompt: 'What was the population of Tokyo in 1920?',
    claim: 'The population of Tokyo in 1920 was approximately 3.7 million residents.',
    expected: 'UNVERIFIABLE',
  },
  {
    id: 'oob-eiffel',
    category: 'out-of-kb',
    prompt: 'How tall is the Eiffel Tower?',
    claim: 'The Eiffel Tower is about 330 metres tall.',
    expected: 'UNVERIFIABLE',
  },

  // ---- Web answerable (4), web search on ----
  {
    id: 'web-gdpr-erasure',
    category: 'web-answerable',
    prompt: 'What does GDPR Article 17 say about erasing personal data?',
    claim: 'Under GDPR Article 17, individuals have the right to have their personal data erased without undue delay.',
    expected: 'GROUNDED',
    enableWebSearch: true,
  },
  {
    id: 'web-gdpr-one-month',
    category: 'web-answerable',
    prompt: 'How long does an organisation have to respond to a GDPR erasure request?',
    claim: 'Under GDPR, a controller must respond to an erasure request within one month of receiving it.',
    expected: 'GROUNDED',
    enableWebSearch: true,
    note: 'GDPR Article 12(3).',
  },
  {
    id: 'web-eu-withdrawal',
    category: 'web-answerable',
    prompt: 'How long do EU consumers have to withdraw from an online purchase?',
    claim: 'The EU Consumer Rights Directive gives consumers 14 days to withdraw from an online purchase.',
    expected: 'GROUNDED',
    enableWebSearch: true,
    note: 'Shares "14 days" with the refund policy; the KB must not ground it (wrong topic).',
  },
  {
    id: 'web-upu-un',
    category: 'web-answerable',
    prompt: 'What is the Universal Postal Union?',
    claim: 'The Universal Postal Union is a specialized agency of the United Nations.',
    expected: 'GROUNDED',
    enableWebSearch: true,
  },
];
