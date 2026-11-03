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

/**
 * IDs of the demo audit records that earlier versions seeded into localStorage.
 * Used only by the one-time migration below to remove them; real checks use
 * crypto.randomUUID() and cannot collide with these fixed IDs.
 */
const LEGACY_SEEDED_CHECK_IDS: ReadonlySet<string> = new Set([
  'c1b489a2-9471-46df-a185-1d6ebfa77201',
  'c2e994d3-1188-4bb8-8820-2df1176b9112',
  'c3f101ab-7231-4821-99ee-341a998bc431',
  'c4a558dc-8314-411a-821b-88a4421cc999',
  'c5b882dd-9002-4fc3-a212-001229aa1482',
  'c6d441ae-2391-447a-8b1e-66a7781fbc02',
  'c7e559ff-4311-4412-bc71-99882200aabb',
]);

const MIGRATIONS_STORAGE_KEY = 'groundcheck_migrations_v1';
const MIGRATION_REMOVE_SEEDED_CHECKS = 'remove-seeded-demo-checks';

function readCompletedMigrations(): string[] {
  try {
    const raw = localStorage.getItem(MIGRATIONS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch (e) {
    console.warn('Failed reading storage migrations', e);
    return [];
  }
}

/**
 * One-time migration: delete the previously seeded demo checks from stored checks,
 * leaving every real check untouched. Marked done only after a successful write
 * (or when there is nothing to migrate), so a failed attempt is retried next load.
 */
export function removeSeededDemoChecks(): number {
  const done = readCompletedMigrations();
  if (done.includes(MIGRATION_REMOVE_SEEDED_CHECKS)) return 0;
  try {
    const raw = localStorage.getItem(CHECKS_STORAGE_KEY);
    let removed = 0;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const kept = parsed.filter((c: unknown) => {
          const id = typeof c === 'object' && c !== null ? (c as { checkId?: unknown }).checkId : undefined;
          return !(typeof id === 'string' && LEGACY_SEEDED_CHECK_IDS.has(id));
        });
        removed = parsed.length - kept.length;
        if (removed > 0) localStorage.setItem(CHECKS_STORAGE_KEY, JSON.stringify(kept));
      }
    }
    localStorage.setItem(MIGRATIONS_STORAGE_KEY, JSON.stringify([...done, MIGRATION_REMOVE_SEEDED_CHECKS]));
    if (removed > 0) console.info(`Removed ${removed} seeded demo check(s) from the local audit log.`);
    return removed;
  } catch (e) {
    console.warn('Seeded demo check migration failed; it will be retried on next load', e);
    return 0;
  }
}

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
  removeSeededDemoChecks();
  try {
    const raw = localStorage.getItem(CHECKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CheckRecord[];
    console.warn('Stored checks are not an array; starting with an empty audit log (stored data left untouched).');
  } catch (e) {
    // Do not overwrite unreadable data: leave it in storage so it can be inspected or recovered.
    console.warn('Failed to parse checks from storage; starting with an empty audit log', e);
  }
  return [];
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

/** Reset to the default knowledge base, an EMPTY audit log and the default threshold. */
export function resetAllData(): { kb: KnowledgeBaseDoc[]; checks: CheckRecord[] } {
  saveKnowledgeBase(INITIAL_DOCS);
  saveChecks([]);
  setThreshold(DEFAULT_THRESHOLD);
  return { kb: INITIAL_DOCS, checks: [] };
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
