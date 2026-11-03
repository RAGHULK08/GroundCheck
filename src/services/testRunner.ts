import type { ClaimAnalysis, ClaimStatus, KnowledgeBaseDoc } from '../types/groundcheck';
import { verifyResponse } from './verifier';
import { DEFAULT_THRESHOLD, INITIAL_DOCS } from './storage';
import {
  TEST_CASE_CATEGORIES,
  TestCaseCategory,
  VERIFIER_TEST_CASES,
  VerifierTestCase,
} from './verifier.test-cases';

/**
 * Runs the labelled test cases through the real verifier (embeddings, NLI and web
 * search via the existing service modules) and scores claim statuses against labels.
 * Nothing is mocked: results depend on live model outputs. Runs are not saved to
 * the audit log.
 */

export type TestOutcome = 'pass' | 'fail' | 'error';

export interface TestCaseResult {
  testCase: VerifierTestCase;
  outcome: TestOutcome;
  /** Status the verifier produced, when it ran. */
  actual?: ClaimStatus;
  reason: string;
  isContradicted?: boolean;
  /** Full claim log for drill-down. */
  claim?: ClaimAnalysis;
  /** Infrastructure problems that make this result unreliable (NLI/search failures, claim split). */
  warnings: string[];
  durationMs: number;
}

export interface CategoryAccuracy {
  category: TestCaseCategory;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** passed / total, 0..1. */
  accuracy: number;
}

export interface TestReport {
  startedAt: string;
  durationMs: number;
  threshold: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** passed / total, 0..1 (errors count as not passed). */
  accuracy: number;
  /** Cases whose result carries an infrastructure warning. */
  withWarnings: number;
  byCategory: CategoryAccuracy[];
  results: TestCaseResult[];
}

export interface RunTestCasesOptions {
  cases?: readonly VerifierTestCase[];
  /** Knowledge base the cases were written against. Defaults to INITIAL_DOCS. */
  kb?: KnowledgeBaseDoc[];
  threshold?: number;
  /** Cases verified at the same time (each one already runs parallel NLI calls). */
  concurrency?: number;
  onProgress?: (done: number, total: number, latest: TestCaseResult) => void;
}

const DEFAULT_CONCURRENCY = 2;

/** Pure: infrastructure warnings for one claim's analysis. */
export function collectWarnings(claim: ClaimAnalysis, claimCount: number): string[] {
  const warnings: string[] = [];
  if (claimCount !== 1) warnings.push(`Claim was split into ${claimCount} sentences; scored the first`);
  const kbNliErrors = claim.top3Chunks.filter((c) => c.nli.error).length;
  if (kbNliErrors > 0) warnings.push(`NLI failed on ${kbNliErrors} KB chunk(s)`);
  const webNliErrors = (claim.webMatches ?? []).filter((m) => m.nli?.error).length;
  if (webNliErrors > 0) warnings.push(`NLI failed on ${webNliErrors} web snippet(s)`);
  if (claim.webSearchError) warnings.push(`Web search unavailable: ${claim.webSearchError}`);
  if (claim.searchQueryDegraded) warnings.push('Search query degraded to claim only');
  return warnings;
}

async function runOne(
  testCase: VerifierTestCase,
  kb: KnowledgeBaseDoc[],
  threshold: number
): Promise<TestCaseResult> {
  const start = performance.now();
  const elapsed = (): number => Math.round(performance.now() - start);
  try {
    const { result } = await verifyResponse(
      testCase.prompt,
      testCase.claim,
      'test-runner',
      kb,
      threshold,
      testCase.enableWebSearch === true
    );
    const claim = result.claimsAnalysis[0];
    if (!claim) {
      return {
        testCase,
        outcome: 'error',
        reason: 'Verifier returned no claims for this case',
        warnings: [],
        durationMs: elapsed(),
      };
    }
    return {
      testCase,
      outcome: claim.status === testCase.expected ? 'pass' : 'fail',
      actual: claim.status,
      reason: claim.statusReason,
      isContradicted: claim.isContradicted,
      claim,
      warnings: collectWarnings(claim, result.claimsAnalysis.length),
      durationMs: elapsed(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Test case ${testCase.id} failed to run:`, msg);
    return { testCase, outcome: 'error', reason: `Verifier threw: ${msg}`, warnings: [], durationMs: elapsed() };
  }
}

/** Pure: aggregate per-case results into a report. */
export function summarize(
  results: TestCaseResult[],
  threshold: number,
  startedAt: string,
  durationMs: number
): TestReport {
  const count = (list: TestCaseResult[], o: TestOutcome): number => list.filter((r) => r.outcome === o).length;
  const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);

  const byCategory: CategoryAccuracy[] = TEST_CASE_CATEGORIES.map((category) => {
    const inCat = results.filter((r) => r.testCase.category === category);
    const passed = count(inCat, 'pass');
    return {
      category,
      total: inCat.length,
      passed,
      failed: count(inCat, 'fail'),
      errored: count(inCat, 'error'),
      accuracy: ratio(passed, inCat.length),
    };
  }).filter((c) => c.total > 0);

  const passed = count(results, 'pass');
  return {
    startedAt,
    durationMs,
    threshold,
    total: results.length,
    passed,
    failed: count(results, 'fail'),
    errored: count(results, 'error'),
    accuracy: ratio(passed, results.length),
    withWarnings: results.filter((r) => r.warnings.length > 0).length,
    byCategory,
    results,
  };
}

/** Run all labelled cases with limited concurrency. Never throws; per-case errors are reported. */
export async function runTestCases(options: RunTestCasesOptions = {}): Promise<TestReport> {
  const cases = options.cases ?? VERIFIER_TEST_CASES;
  const kb = options.kb ?? INITIAL_DOCS;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const startedAt = new Date().toISOString();
  const start = performance.now();

  const results: TestCaseResult[] = new Array(cases.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runOne(cases[i], kb, threshold);
      done++;
      options.onProgress?.(done, cases.length, results[i]);
    }
  };
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, cases.length); w++) workers.push(worker());
  await Promise.all(workers);

  return summarize(results, threshold, startedAt, Math.round(performance.now() - start));
}
