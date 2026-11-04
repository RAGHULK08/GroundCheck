import { runTestCases, TestReport } from '../src/services/testRunner.ts';
import { VERIFIER_TEST_CASES } from '../src/services/verifier.test-cases.ts';

async function main() {
  console.log(`Starting 20-case suite run (${VERIFIER_TEST_CASES.length} cases)...`);
  const startTime = Date.now();

  const report: TestReport = await runTestCases({
    concurrency: 1, // run sequentially to avoid triggering Gemini rate limits / 429
    onProgress: (done, total, latest) => {
      console.log(`[${done}/${total}] Case ${latest.testCase.id} (${latest.testCase.category}): ${latest.outcome.toUpperCase()} (expected: ${latest.testCase.expected}, actual: ${latest.actual ?? 'none'}, ${latest.durationMs}ms)`);
      if (latest.outcome !== 'pass') {
        console.log(`   -> Reason: ${latest.reason}`);
        if (latest.warnings.length) console.log(`   -> Warnings: ${latest.warnings.join('; ')}`);
      }
    },
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n==================================================');
  console.log(`SUITE RUN FINISHED in ${durationSec}s`);
  console.log(`Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed} | Errored: ${report.errored}`);
  console.log(`Ran: ${report.ran} | Overall Accuracy: ${(report.accuracy !== null ? (report.accuracy * 100).toFixed(1) + '%' : 'N/A')}`);
  console.log('==================================================\n');

  console.log('Category Breakdown:');
  for (const cat of report.byCategory) {
    const accStr = cat.accuracy !== null ? `${(cat.accuracy * 100).toFixed(1)}%` : 'N/A';
    console.log(`  - ${cat.category.padEnd(32)}: ${cat.passed}/${cat.ran} passed (${accStr}) [errored: ${cat.errored}]`);
  }

  console.log('\nDetailed Case Results:');
  const summaryResults = report.results.map(r => ({
    id: r.testCase.id,
    category: r.testCase.category,
    expected: r.testCase.expected,
    actual: r.actual,
    outcome: r.outcome,
    durationMs: r.durationMs,
    reason: r.reason,
    warnings: r.warnings
  }));
  console.log(JSON.stringify(summaryResults, null, 2));

  const fs = await import('fs');
  fs.writeFileSync('test-report.json', JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    errored: report.errored,
    ran: report.ran,
    accuracy: report.accuracy,
    durationMs: report.durationMs,
    byCategory: report.byCategory,
    results: summaryResults,
  }, null, 2));
  console.log('Saved report to test-report.json');
}

main().catch(err => {
  console.error('Fatal suite run error:', err);
  process.exit(1);
});
