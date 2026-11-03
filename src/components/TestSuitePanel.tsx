import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, FlaskConical, Play, XCircle } from 'lucide-react';
import type { TestCaseResult, TestReport } from '../services/testRunner';
import { ClaimLogCard } from './ClaimLogCard';
import { useSearchProviderLabel } from '../services/searchProvider';

/**
 * Presentational test-suite view. The parent runs the cases (testRunner.ts) and
 * passes the report in; this component makes no service or model calls.
 */

export interface TestSuitePanelProps {
  report: TestReport | null;
  isRunning: boolean;
  progress: { done: number; total: number } | null;
  totalCases: number;
  onRun: () => void;
}

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

interface OutcomeBadgeProps {
  result: TestCaseResult;
}

const OutcomeBadge: React.FC<OutcomeBadgeProps> = ({ result }) => {
  if (result.outcome === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
        <CheckCircle className="w-3 h-3" /> PASS
      </span>
    );
  }
  if (result.outcome === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300">
        <XCircle className="w-3 h-3" /> FAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 border border-amber-500/40 text-amber-300">
      <AlertTriangle className="w-3 h-3" /> ERROR
    </span>
  );
};

export const TestSuitePanel: React.FC<TestSuitePanelProps> = ({ report, isRunning, progress, totalCases, onRun }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const searchLabel = useSearchProviderLabel();

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 lg:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-cyan-400" />
            Labelled test cases ({totalCases})
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Runs every case through the live verifier (Gemini embeddings and NLI, plus web search via {searchLabel}) against the
            default refund and shipping policies. Results are real model outputs and are not saved to the audit log.
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center gap-2 shrink-0 cursor-pointer"
        >
          {isRunning ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>
                Running{progress ? ` ${progress.done}/${progress.total}` : ''}...
              </span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Run test cases</span>
            </>
          )}
        </button>
      </div>

      {report && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-slate-300 bg-slate-950/70 p-3 rounded-lg border border-slate-800">
            <span>
              {report.accuracy === null ? (
                <strong className="text-amber-300 text-sm">
                  {report.errored} error{report.errored === 1 ? '' : 's'}, 0 run (no accuracy)
                </strong>
              ) : (
                <>
                  Accuracy over cases that ran: <strong className="text-white text-sm">{pct(report.accuracy)}</strong> (
                  {report.passed}/{report.ran})
                </>
              )}
            </span>
            <span className="text-rose-300">Failed: {report.failed}</span>
            <span className="text-amber-300">Errors (not scored): {report.errored}</span>
            {report.withWarnings > 0 && (
              <span className="text-amber-300" title="NLI or web search failures make these results unreliable">
                With infra warnings: {report.withWarnings}
              </span>
            )}
            <span className="text-slate-500">
              threshold {report.threshold.toFixed(2)} · {(report.durationMs / 1000).toFixed(1)} s
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {report.byCategory.map((c) => (
              <div key={c.category} className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
                <div className="text-[10px] font-mono text-slate-500 truncate" title={c.category}>
                  {c.category}
                </div>
                <div className="text-lg font-bold text-white">{c.accuracy === null ? '—' : pct(c.accuracy)}</div>
                <div className="text-[10px] font-mono text-slate-400">
                  {c.ran > 0 ? `${c.passed}/${c.ran} passed` : 'none ran'}
                  {c.errored > 0 ? ` · ${c.errored} error${c.errored === 1 ? '' : 's'}` : ''}
                </div>
              </div>
            ))}
          </div>

          {report.errorGroups.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-xs space-y-1.5">
              <div className="font-semibold text-amber-300">
                Errors by cause (excluded from accuracy, never counted as verdicts):
              </div>
              {report.errorGroups.map((g) => (
                <div key={g.message} className="font-mono text-[11px] text-amber-200/90 break-words">
                  <span className="text-amber-300 font-bold">×{g.count}</span> {g.message}
                  <span className="text-amber-400/60"> ({g.caseIds.join(', ')})</span>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-950/80 text-slate-400 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2">Result</th>
                  <th className="text-left p-2">Case</th>
                  <th className="text-left p-2 min-w-[220px]">Claim</th>
                  <th className="text-left p-2">Expected</th>
                  <th className="text-left p-2">Actual</th>
                  <th className="text-left p-2 min-w-[260px]">Reason</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => {
                  const isOpen = expandedId === r.testCase.id;
                  return (
                    <React.Fragment key={r.testCase.id}>
                      <tr
                        onClick={() => setExpandedId(isOpen ? null : r.testCase.id)}
                        className="border-t border-slate-800 hover:bg-slate-900/60 cursor-pointer align-top"
                      >
                        <td className="p-2">
                          <OutcomeBadge result={r} />
                        </td>
                        <td className="p-2 font-mono text-[10px] text-slate-400">
                          <div className="text-slate-200">{r.testCase.id}</div>
                          <div>{r.testCase.category}</div>
                          {r.testCase.enableWebSearch && <div className="text-cyan-400">web on</div>}
                        </td>
                        <td className="p-2 text-slate-200">{r.testCase.claim}</td>
                        <td className="p-2 font-mono text-[10px]">{r.testCase.expected}</td>
                        <td className="p-2 font-mono text-[10px]">
                          {r.actual ?? '—'}
                          {r.isContradicted && <div className="text-rose-300">contradicted</div>}
                        </td>
                        <td className="p-2 text-slate-300 break-words">
                          {r.reason}
                          {r.warnings.length > 0 && (
                            <div className="mt-1 text-[10px] text-amber-300">⚠ {r.warnings.join('; ')}</div>
                          )}
                        </td>
                      </tr>
                      {isOpen && r.claim && (
                        <tr className="border-t border-slate-800">
                          <td colSpan={6} className="p-2 bg-slate-950/60">
                            <ClaimLogCard
                              claim={r.claim}
                              index={1}
                              webSearchEnabled={r.testCase.enableWebSearch === true}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-500">Click a row to see its full claim log (chunks, NLI, web evidence).</p>
        </>
      )}
    </div>
  );
};
