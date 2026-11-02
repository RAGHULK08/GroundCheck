import { CheckRecord, DailyModelStat, KnowledgeBaseDoc } from '../types/groundcheck';

const KB_STORAGE_KEY = 'groundcheck_kb_v1';
const CHECKS_STORAGE_KEY = 'groundcheck_checks_v1';
const THRESHOLD_STORAGE_KEY = 'groundcheck_threshold_v1';

export const DEFAULT_THRESHOLD = 0.60;

export const INITIAL_DOCS: KnowledgeBaseDoc[] = [
  {
    docId: 'doc-refund-001',
    title: 'Refund Policy',
    content: `Our refund policy allows customers to request a full refund within 14 days of purchase, provided the item is unused and in its original packaging. Refunds are processed within 5 to 7 business days after the returned item is received. Digital products and gift cards are non-refundable. Customers must contact support with their order number to initiate a return.`,
    source: 'sample_docs/refund_policy.txt',
    embedding: [],
    createdAt: '2026-10-25T10:00:00Z',
  },
  {
    docId: 'doc-shipping-002',
    title: 'Shipping Policy',
    content: `Standard shipping takes 3 to 5 business days within the country and is free on orders above 999 rupees. Express shipping is available for an additional fee and delivers within 1 to 2 business days. International shipping is currently available to select countries and takes 7 to 14 business days. Tracking information is emailed to the customer once the order ships.`,
    source: 'sample_docs/shipping_policy.txt',
    embedding: [],
    createdAt: '2026-10-25T10:00:00Z',
  },
];

export const INITIAL_CHECKS: CheckRecord[] = [
  {
    checkId: 'c1b489a2-9471-46df-a185-1d6ebfa77201',
    prompt: 'What is our refund policy for electronics and digital downloads?',
    response: 'Refunds are issued within 30 days, no questions asked. Digital products can also be refunded at any time as long as you provide the license key.',
    modelName: 'gpt-4o',
    verdict: 'HALLUCINATED',
    confidenceScore: 0.3850,
    flaggedSpans: [
      {
        text: 'Refunds are issued within 30 days, no questions asked.',
        reason: 'Conflict in timeframe: claim states 30 days, which does not match source policy (similarity 0.38 < 0.60)',
        closestDocId: 'doc-refund-001',
        closestDocTitle: 'Refund Policy',
        score: 0.38,
      },
      {
        text: 'Digital products can also be refunded at any time as long as you provide the license key.',
        reason: 'Contradiction: policy explicitly states digital products and gift cards are non-refundable (similarity 0.28 < 0.60)',
        closestDocId: 'doc-refund-001',
        closestDocTitle: 'Refund Policy',
        score: 0.28,
      },
    ],
    sourceDocIds: ['doc-refund-001'],
    latencyMs: 142.5,
    createdAt: '2026-10-30T14:22:10Z',
  },
  {
    checkId: 'c2e994d3-1188-4bb8-8820-2df1176b9112',
    prompt: 'How long does standard delivery take and is there a free shipping threshold?',
    response: 'Standard shipping takes 3 to 5 business days within the country and is free on orders above 999 rupees. Tracking information is emailed to the customer once the order ships.',
    modelName: 'claude-3-5-sonnet',
    verdict: 'GROUNDED',
    confidenceScore: 0.9420,
    flaggedSpans: [],
    sourceDocIds: ['doc-shipping-002'],
    latencyMs: 118.2,
    createdAt: '2026-10-30T16:45:00Z',
  },
  {
    checkId: 'c3f101ab-7231-4821-99ee-341a998bc431',
    prompt: 'Can you summarize our returns and shipping terms?',
    response: 'Standard shipping takes 3 to 5 business days. Express shipping delivers within 1 to 2 business days. Customers can also return items within 60 days even without receipt.',
    modelName: 'gemini-1.5-pro',
    verdict: 'PARTIAL',
    confidenceScore: 0.6840,
    flaggedSpans: [
      {
        text: 'Customers can also return items within 60 days even without receipt.',
        reason: 'Conflict in timeframe: claim states 60 days, which does not match source policy (similarity 0.34 < 0.60)',
        closestDocId: 'doc-refund-001',
        closestDocTitle: 'Refund Policy',
        score: 0.34,
      },
    ],
    sourceDocIds: ['doc-shipping-002', 'doc-refund-001'],
    latencyMs: 135.0,
    createdAt: '2026-10-31T09:12:30Z',
  },
  {
    checkId: 'c4a558dc-8314-411a-821b-88a4421cc999',
    prompt: 'Do you deliver internationally?',
    response: 'International shipping is currently available to select countries and takes 7 to 14 business days. Tracking details will be emailed once dispatched.',
    modelName: 'gpt-4o',
    verdict: 'GROUNDED',
    confidenceScore: 0.9150,
    flaggedSpans: [],
    sourceDocIds: ['doc-shipping-002'],
    latencyMs: 98.4,
    createdAt: '2026-10-31T11:04:12Z',
  },
  {
    checkId: 'c5b882dd-9002-4fc3-a212-001229aa1482',
    prompt: 'Can I return an item after 3 weeks?',
    response: 'You can return items within 21 days for store credit, and return shipping is always covered by the seller.',
    modelName: 'llama-3-70b',
    verdict: 'HALLUCINATED',
    confidenceScore: 0.3200,
    flaggedSpans: [
      {
        text: 'You can return items within 21 days for store credit, and return shipping is always covered by the seller.',
        reason: 'No supporting source found for 21 days store credit or seller-paid shipping (similarity 0.32 < 0.60)',
        closestDocId: 'doc-refund-001',
        closestDocTitle: 'Refund Policy',
        score: 0.32,
      },
    ],
    sourceDocIds: ['doc-refund-001'],
    latencyMs: 154.2,
    createdAt: '2026-11-01T08:30:00Z',
  },
  {
    checkId: 'c6d441ae-2391-447a-8b1e-66a7781fbc02',
    prompt: 'What are the rules for returning gift cards?',
    response: 'Digital products and gift cards are non-refundable. Customers must contact support with their order number to initiate any return.',
    modelName: 'claude-3-5-sonnet',
    verdict: 'GROUNDED',
    confidenceScore: 0.9650,
    flaggedSpans: [],
    sourceDocIds: ['doc-refund-001'],
    latencyMs: 105.7,
    createdAt: '2026-11-01T14:15:22Z',
  },
  {
    checkId: 'c7e559ff-4311-4412-bc71-99882200aabb',
    prompt: 'Tell me about express shipping and refunds processing time',
    response: 'Express shipping delivers in 1 to 2 business days. Refunds are credited instantly to your bank account within 10 minutes of drop-off.',
    modelName: 'gemini-1.5-pro',
    verdict: 'PARTIAL',
    confidenceScore: 0.6250,
    flaggedSpans: [
      {
        text: 'Refunds are credited instantly to your bank account within 10 minutes of drop-off.',
        reason: 'No supporting source found (source policy requires 5 to 7 business days after receipt) (similarity 0.27 < 0.60)',
        closestDocId: 'doc-refund-001',
        closestDocTitle: 'Refund Policy',
        score: 0.27,
      },
    ],
    sourceDocIds: ['doc-shipping-002', 'doc-refund-001'],
    latencyMs: 122.9,
    createdAt: '2026-11-02T07:20:00Z',
  },
];

export function getThreshold(): number {
  try {
    const raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
    if (raw) {
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0 && val <= 1) {
        return val;
      }
    }
  } catch (e) {
    console.warn('Failed reading threshold from localStorage', e);
  }
  return DEFAULT_THRESHOLD;
}

export function setThreshold(val: number): void {
  try {
    localStorage.setItem(THRESHOLD_STORAGE_KEY, val.toString());
  } catch (e) {
    console.warn('Failed saving threshold', e);
  }
}

export function loadKnowledgeBase(): KnowledgeBaseDoc[] {
  try {
    const raw = localStorage.getItem(KB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse KB from storage', e);
  }
  // Fallback to default
  saveKnowledgeBase(INITIAL_DOCS);
  return INITIAL_DOCS;
}

export function saveKnowledgeBase(docs: KnowledgeBaseDoc[]): void {
  try {
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(docs));
  } catch (e) {
    console.warn('Failed to save KB to storage', e);
  }
}

export function loadChecks(): CheckRecord[] {
  try {
    const raw = localStorage.getItem(CHECKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse checks from storage', e);
  }
  saveChecks(INITIAL_CHECKS);
  return INITIAL_CHECKS;
}

export function saveChecks(checks: CheckRecord[]): void {
  try {
    localStorage.setItem(CHECKS_STORAGE_KEY, JSON.stringify(checks));
  } catch (e) {
    console.warn('Failed to save checks to storage', e);
  }
}

export function appendCheck(check: CheckRecord): CheckRecord[] {
  const all = loadChecks();
  const updated = [check, ...all];
  saveChecks(updated);
  return updated;
}

export function resetAllData(): { kb: KnowledgeBaseDoc[]; checks: CheckRecord[] } {
  saveKnowledgeBase(INITIAL_DOCS);
  saveChecks(INITIAL_CHECKS);
  setThreshold(DEFAULT_THRESHOLD);
  return { kb: INITIAL_DOCS, checks: INITIAL_CHECKS };
}

/**
 * Replicates the DAILY_MODEL_STATS SQL view in Exasol:
 * SELECT CAST(CREATED_AT AS DATE) AS CHECK_DATE, MODEL_NAME, COUNT(*) AS TOTAL_CHECKS,
 *        SUM(CASE WHEN VERDICT = 'HALLUCINATED' THEN 1 ELSE 0 END) AS HALLUCINATED_COUNT, ...
 */
export function calculateDailyModelStats(checks: CheckRecord[]): DailyModelStat[] {
  const map = new Map<string, {
    checkDate: string;
    modelName: string;
    total: number;
    hallucinated: number;
    partial: number;
    unverifiable: number;
    grounded: number;
    confidenceSum: number;
  }>();

  for (const c of checks) {
    const checkDate = c.createdAt ? c.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10);
    const key = `${checkDate}__${c.modelName}`;

    const existing = map.get(key) || {
      checkDate,
      modelName: c.modelName,
      total: 0,
      hallucinated: 0,
      partial: 0,
      unverifiable: 0,
      grounded: 0,
      confidenceSum: 0,
    };

    existing.total += 1;
    existing.confidenceSum += c.confidenceScore;
    if (c.verdict === 'HALLUCINATED') existing.hallucinated += 1;
    else if (c.verdict === 'PARTIAL') existing.partial += 1;
    else if (c.verdict === 'UNVERIFIABLE') existing.unverifiable += 1;
    else if (c.verdict === 'GROUNDED') existing.grounded += 1;

    map.set(key, existing);
  }

  const results: DailyModelStat[] = [];
  for (const val of map.values()) {
    const hallucinationRate = val.total > 0 ? Math.round((val.hallucinated / val.total) * 1000) / 1000 : 0;
    const avgConfidence = val.total > 0 ? Math.round((val.confidenceSum / val.total) * 10000) / 10000 : 0;
    results.push({
      checkDate: val.checkDate,
      modelName: val.modelName,
      totalChecks: val.total,
      hallucinatedCount: val.hallucinated,
      partialCount: val.partial,
      groundedCount: val.grounded,
      unverifiableCount: val.unverifiable,
      avgConfidence,
      hallucinationRate,
    });
  }

  // Sort by CHECK_DATE desc, model name asc
  return results.sort((a, b) => {
    if (b.checkDate !== a.checkDate) {
      return b.checkDate.localeCompare(a.checkDate);
    }
    return a.modelName.localeCompare(b.modelName);
  });
}
