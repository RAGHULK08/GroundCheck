/**
 * Deterministic quantity-conflict check.
 *
 * Extracts numbers that are bound to a unit (days, business days, weeks, hours,
 * rupees, US dollars, including ranges such as "3 to 5 business days") from a claim
 * and an evidence chunk, and reports a conflict only when BOTH texts state a value
 * for the SAME unit and none of the claim's values is consistent with the chunk's.
 *
 * Deliberately conservative: units are never converted (2 weeks vs 14 days is not
 * compared), a unit present in only one text is never a conflict, and a single
 * value that lies inside a stated range (5 days vs "3 to 5 days") is consistent.
 * Pure and dependency-free.
 */

export type QuantityUnit = 'day' | 'business_day' | 'week' | 'hour' | 'INR' | 'USD';

export interface QuantityMention {
  unit: QuantityUnit;
  /** Lower bound (equal to max for a single value). */
  min: number;
  /** Upper bound (equal to min for a single value). */
  max: number;
  /** The matched source text, for explanations. */
  text: string;
}

export interface QuantityConflictResult {
  conflict: boolean;
  reason?: string;
  /** Unit on which the conflict was found (only set when conflict is true). */
  unit?: QuantityUnit;
}

const UNIT_LABELS: Record<QuantityUnit, string> = {
  day: 'days',
  business_day: 'business days',
  week: 'weeks',
  hour: 'hours',
  INR: 'rupees',
  USD: 'US dollars',
};

// A number with optional thousands separators and decimals: 14, 1,000, 1000.50
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
// Range separators: "3-5", "3 – 5", "3 to 5"
const RANGE_SEP = String.raw`\s*(?:-|–|—|to)\s*`;
// The number must not be glued to a preceding letter, digit or decimal point.
const NUM_START = String.raw`(?<![\p{L}\d.,])`;
const END = String.raw`(?![\p{L}\d])`;

/** Suffix units, ordered so "business days" wins over "days". */
const SUFFIX_UNITS: { unit: QuantityUnit; pattern: string }[] = [
  { unit: 'business_day', pattern: String.raw`(?:business|working)[\s-]+days?` },
  { unit: 'day', pattern: String.raw`(?:calendar[\s-]+)?days?` },
  { unit: 'week', pattern: String.raw`weeks?|wks?` },
  { unit: 'hour', pattern: String.raw`hours?|hrs?` },
  { unit: 'INR', pattern: String.raw`rupees?|rs\.?|inr|₹` },
  { unit: 'USD', pattern: String.raw`dollars?|usd` },
];

/** Prefix currency markers: "₹1,000", "Rs. 500", "INR 200", "$50", "USD 20". */
const PREFIX_UNITS: { unit: QuantityUnit; pattern: string }[] = [
  { unit: 'INR', pattern: String.raw`₹|rs\.?|inr` },
  { unit: 'USD', pattern: String.raw`\$|usd` },
];

const SUFFIX_REGEXES = SUFFIX_UNITS.map(({ unit, pattern }) => ({
  unit,
  // "3 to 5 business days", "14 days", "14-day", "1000 rupees"
  regex: new RegExp(`${NUM_START}(${NUM})(?:${RANGE_SEP}(${NUM}))?\\s*-?\\s*(?:${pattern})${END}`, 'giu'),
}));

const PREFIX_REGEXES = PREFIX_UNITS.map(({ unit, pattern }) => ({
  unit,
  // "₹1,000", "$5 - $10", "Rs. 100 to 200"
  regex: new RegExp(
    `(?<![\\p{L}\\d])(?:${pattern})\\s*(${NUM})(?:${RANGE_SEP}(?:${pattern})?\\s*(${NUM}))?${END}`,
    'giu'
  ),
}));

const BETWEEN_REGEX = new RegExp(`\\bbetween\\s+(${NUM})\\s+and\\s+(${NUM})`, 'giu');

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

function formatMention(m: QuantityMention): string {
  return m.min === m.max ? `${m.min}` : `${m.min}–${m.max}`;
}

/**
 * Extract every unit-bound quantity from `text`. Duplicates (same unit and bounds)
 * are collapsed. Numbers without a recognized unit are ignored.
 */
export function extractQuantities(text: string): QuantityMention[] {
  // Rewrite "between 3 and 5" as "3 to 5" so it is handled by the range syntax.
  const normalized = text.replace(BETWEEN_REGEX, '$1 to $2');
  const seen = new Set<string>();
  const mentions: QuantityMention[] = [];

  const add = (unit: QuantityUnit, a: string, b: string | undefined, matched: string): void => {
    const x = parseNumber(a);
    const y = b !== undefined ? parseNumber(b) : x;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const min = Math.min(x, y);
    const max = Math.max(x, y);
    const key = `${unit}:${min}:${max}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push({ unit, min, max, text: matched.trim() });
  };

  for (const { unit, regex } of [...SUFFIX_REGEXES, ...PREFIX_REGEXES]) {
    for (const m of normalized.matchAll(regex)) {
      add(unit, m[1], m[2], m[0]);
    }
  }
  return mentions;
}

/** A claim value is consistent with a source value if it lies within the source's bounds. */
function isConsistent(claim: QuantityMention, source: QuantityMention): boolean {
  return claim.min >= source.min && claim.max <= source.max;
}

/**
 * Report a conflict only if claim and chunk both state a quantity in the same unit
 * and NO claim value for that unit is consistent with ANY chunk value for that unit.
 */
export function findQuantityConflict(claim: string, chunkText: string): QuantityConflictResult {
  const claimMentions = extractQuantities(claim);
  if (claimMentions.length === 0) return { conflict: false };
  const chunkMentions = extractQuantities(chunkText);
  if (chunkMentions.length === 0) return { conflict: false };

  const units = new Set<QuantityUnit>(claimMentions.map((m) => m.unit));
  for (const unit of units) {
    const claimForUnit = claimMentions.filter((m) => m.unit === unit);
    const chunkForUnit = chunkMentions.filter((m) => m.unit === unit);
    if (chunkForUnit.length === 0) continue;

    const anyConsistent = claimForUnit.some((c) => chunkForUnit.some((s) => isConsistent(c, s)));
    if (!anyConsistent) {
      return {
        conflict: true,
        unit,
        reason: `Quantity conflict (${UNIT_LABELS[unit]}): claim states ${claimForUnit
          .map(formatMention)
          .join(', ')}, source states ${chunkForUnit.map(formatMention).join(', ')}`,
      };
    }
  }
  return { conflict: false };
}
