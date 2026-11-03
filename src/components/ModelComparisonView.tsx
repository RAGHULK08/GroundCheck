import React, { useState } from 'react';
import {
  Scale,
  Sparkles,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  ShieldAlert,
  Trophy,
  ArrowRight,
  TrendingDown,
  Layers,
  Save,
  Check,
  Globe,
  ExternalLink,
  FileText,
  HelpCircle,
} from 'lucide-react';
import {
  CheckRecord,
  DailyModelStat,
  KnowledgeBaseDoc,
  VerificationResult,
  Verdict,
} from '../types/groundcheck';
import { verifyResponse } from '../services/verifier';

interface ModelComparisonViewProps {
  kbDocs: KnowledgeBaseDoc[];
  threshold: number;
  dailyStats: DailyModelStat[];
  onBatchLogChecks: (records: CheckRecord[]) => void;
}

interface BenchmarkPrompt {
  title: string;
  prompt: string;
  modelResponses: Record<string, string>;
}

const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    title: 'Refund Policy & Digital Returns',
    prompt: 'What is our refund policy for electronics and digital downloads?',
    modelResponses: {
      'claude-3-5-sonnet':
        'Our refund policy allows customers to request a full refund within 14 days of purchase, provided the item is unused and in its original packaging. Refunds are processed within 5 to 7 business days. Digital products and gift cards are non-refundable.',
      'gpt-4o':
        'Refunds are issued within 30 days, no questions asked. Digital products can also be refunded at any time as long as you provide the software license key.',
      'gemini-1.5-pro':
        'Customers can request a full refund within 14 days for unused items in original packaging. However, support can also provide exceptions for digital downloads on a case-by-case basis.',
      'llama-3-70b':
        'You can return items within 21 days for store credit, and return shipping is always covered by the seller. Digital items are refundable within 48 hours.',
    },
  },
  {
    title: 'Shipping Times & Free Shipping',
    prompt: 'How long does shipping take and what are the rates?',
    modelResponses: {
      'claude-3-5-sonnet':
        'Standard shipping takes 3 to 5 business days within the country and is free on orders above 999 rupees. Express shipping delivers within 1 to 2 business days for an additional fee.',
      'gemini-1.5-pro':
        'Standard shipping takes 3 to 5 business days and is free on orders above 999 rupees. Free international shipping is available for all prime customers.',
      'gpt-4o':
        'Standard shipping takes 3 to 5 business days within the country. International shipping is available to select countries and takes 7 to 14 business days.',
      'llama-3-70b':
        'All orders ship same day and arrive within 24 hours nationwide with free shipping on every order regardless of cart value.',
    },
  },
];

const AVAILABLE_MODELS = [
  'claude-3-5-sonnet',
  'gpt-4o',
  'gemini-1.5-pro',
  'llama-3-70b',
  'mistral-large',
];

interface ModelEvaluationState {
  modelName: string;
  response: string;
  result?: VerificationResult;
  usedDocIds?: string[];
  isVerifying?: boolean;
}

export const ModelComparisonView: React.FC<ModelComparisonViewProps> = ({
  kbDocs,
  threshold,
  dailyStats,
  onBatchLogChecks,
}) => {
  const [selectedModels, setSelectedModels] = useState<string[]>([
    'claude-3-5-sonnet',
    'gpt-4o',
    'gemini-1.5-pro',
  ]);

  const [prompt, setPrompt] = useState(BENCHMARK_PROMPTS[0].prompt);
  const [modelResponses, setModelResponses] = useState<Record<string, string>>({
    ...BENCHMARK_PROMPTS[0].modelResponses,
    'mistral-large':
      'Refunds are available within 14 days of purchase. Support can assist with processing returns in 5 to 7 days.',
  });

  const [evaluations, setEvaluations] = useState<Record<string, ModelEvaluationState>>({});
  const [isComparing, setIsComparing] = useState(false);
  const [loggedToAudit, setLoggedToAudit] = useState(false);

  // Apply a benchmark template
  const handleSelectPreset = (preset: BenchmarkPrompt) => {
    setPrompt(preset.prompt);
    setModelResponses((prev) => ({
      ...prev,
      ...preset.modelResponses,
    }));
    setEvaluations({});
    setLoggedToAudit(false);
  };

  // Toggle model selection
  const handleToggleModel = (model: string) => {
    if (selectedModels.includes(model)) {
      if (selectedModels.length <= 2) {
        return; // maintain at least 2 models for side-by-side comparison
      }
      setSelectedModels(selectedModels.filter((m) => m !== model));
    } else {
      setSelectedModels([...selectedModels, model]);
    }
  };

  // Update response for a given model
  const handleUpdateResponse = (model: string, text: string) => {
    setModelResponses((prev) => ({ ...prev, [model]: text }));
  };

  // Run evaluation across all selected models simultaneously
  const handleEvaluateAll = async () => {
    if (!prompt.trim()) return;
    setIsComparing(true);
    setLoggedToAudit(false);

    const newEvals: Record<string, ModelEvaluationState> = {};
    try {
      for (const model of selectedModels) {
        const resp = modelResponses[model] || 'No response provided.';
        try {
          const { result, usedDocIds } = await verifyResponse(
            prompt,
            resp,
            model,
            kbDocs,
            threshold,
            true
          );
          newEvals[model] = {
            modelName: model,
            response: resp,
            result,
            usedDocIds,
          };
        } catch (e) {
          console.error(`Evaluation failed for ${model}`, e);
        }
      }

      setEvaluations(newEvals);
    } finally {
      // Loading state follows the real verification promises.
      setIsComparing(false);
    }
  };

  // Batch commit comparison checks to Exasol audit trail
  const handleLogToAuditTrail = () => {
    const checksToLog: CheckRecord[] = [];
    const timestamp = new Date().toISOString();

    for (const model of selectedModels) {
      const ev = evaluations[model];
      if (ev && ev.result) {
        checksToLog.push({
          checkId: ev.result.checkId,
          prompt,
          response: ev.response,
          modelName: model,
          verdict: ev.result.verdict,
          confidenceScore: ev.result.confidenceScore,
          flaggedSpans: ev.result.flaggedSpans,
          sourceDocIds: ev.usedDocIds || [],
          latencyMs: ev.result.latencyMs,
          createdAt: timestamp,
          citations: ev.result.citations,
          usedWebSearch: ev.result.usedWebSearch,
          claimsAnalysis: ev.result.claimsAnalysis,
        });
      }
    }

    if (checksToLog.length > 0) {
      onBatchLogChecks(checksToLog);
      setLoggedToAudit(true);
      setTimeout(() => setLoggedToAudit(false), 5000);
    }
  };

  // Get historical hallucination rate for a model from Exasol DAILY_MODEL_STATS
  const getHistoricalStats = (model: string) => {
    const modelRows = dailyStats.filter((s) => s.modelName === model);
    if (modelRows.length === 0) return null;

    const total = modelRows.reduce((acc, row) => acc + row.totalChecks, 0);
    const hallucinated = modelRows.reduce((acc, row) => acc + row.hallucinatedCount, 0);
    const rate = total > 0 ? (hallucinated / total) * 100 : 0;
    return {
      total,
      hallucinationRate: rate.toFixed(1),
    };
  };

  // Determine best performing model among evaluated models
  const evaluatedList = selectedModels
    .map((m) => evaluations[m])
    .filter((e): e is ModelEvaluationState => !!e && !!e.result);

  const bestModel =
    evaluatedList.length > 0
      ? [...evaluatedList].sort((a, b) => {
          // Verdict priority: GROUNDED > PARTIAL > UNVERIFIABLE > HALLUCINATED
          const weight = (v: Verdict) =>
            v === 'GROUNDED' ? 4 : v === 'PARTIAL' ? 3 : v === 'UNVERIFIABLE' ? 2 : 1;
          const diff = weight(b.result!.verdict) - weight(a.result!.verdict);
          if (diff !== 0) return diff;
          // Tie-break by confidence score
          return b.result!.confidenceScore - a.result!.confidenceScore;
        })[0]
      : null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 lg:p-6 space-y-6 shadow-xl">
      {/* Header and Introduction */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
              Side-by-Side Model Comparison &amp; Benchmark
            </h2>
          </div>
          <p className="text-xs lg:text-sm text-slate-400 mt-1">
            Evaluate the same prompt across multiple LLMs simultaneously to compare verdicts, confidence scores, and hallucination rates against the local knowledge base.
          </p>
        </div>

        {/* Action button */}
        <div className="flex items-center gap-2">
          {evaluatedList.length > 0 && (
            <button
              onClick={handleLogToAuditTrail}
              disabled={loggedToAudit}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                loggedToAudit
                  ? 'bg-emerald-950 border border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
              title="Save all comparison evaluations as audit records in browser local storage"
            >
              {loggedToAudit ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Saved to audit log</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 text-cyan-400" />
                  <span>Log Benchmark to Audit Trail</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={handleEvaluateAll}
            disabled={isComparing}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-md shadow-cyan-600/20 transition active:scale-[0.99] cursor-pointer"
          >
            {isComparing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Benchmarking Models...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Evaluate Selected Models ({selectedModels.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preset Benchmarks & Model Selectors */}
      <div className="space-y-3">
        {/* Presets */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Benchmark Presets:
          </span>
          {BENCHMARK_PROMPTS.map((b, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectPreset(b)}
              className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
            >
              {b.title}
            </button>
          ))}
        </div>

        {/* Model Chips (Select multiple) */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">Select Models to Benchmark (min 2):</span>
          {AVAILABLE_MODELS.map((m) => {
            const isSelected = selectedModels.includes(m);
            const hist = getHistoricalStats(m);
            return (
              <button
                key={m}
                onClick={() => handleToggleModel(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs transition cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/70 border-cyan-500/80 text-cyan-200 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSelected ? 'bg-cyan-400' : 'bg-slate-600'
                  }`}
                />
                <span className="font-semibold">{m}</span>
                {hist && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({hist.hallucinationRate}% hist. hallucination)
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Common Prompt */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
            Common Prompt (Evaluated simultaneously across all models)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="Type a benchmark prompt..."
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition resize-none"
          />
        </div>
      </div>

      {/* Benchmark Summary Bar (When Evaluated) */}
      {bestModel && bestModel.result && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-cyan-950/40 to-slate-900 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Benchmark Winner for this prompt
              </div>
              <div className="text-base font-bold text-white flex items-center gap-2">
                <span>{bestModel.modelName}</span>
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-emerald-950 border border-emerald-500/40 text-emerald-300">
                  {bestModel.result.verdict}
                </span>
                <span className="text-xs text-slate-300 font-mono">
                  Confidence: <strong>{bestModel.result.confidenceScore.toFixed(4)}</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-slate-300">
            <div>
              Claims Flagged: <strong className="text-white">{bestModel.result.numFlagged} / {bestModel.result.numClaims}</strong>
            </div>
            <div className="text-slate-600">•</div>
            <div>
              Verification Latency: <strong className="text-white">{bestModel.result.latencyMs} ms</strong>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Model Comparison Grid */}
      <div
        className={`grid grid-cols-1 md:grid-cols-${Math.min(
          selectedModels.length,
          3
        )} lg:grid-cols-${selectedModels.length} gap-4`}
      >
        {selectedModels.map((model) => {
          const evalState = evaluations[model];
          const result = evalState?.result;
          const hist = getHistoricalStats(model);

          return (
            <div
              key={model}
              className={`flex flex-col bg-slate-950/70 border rounded-xl overflow-hidden transition-all ${
                bestModel?.modelName === model
                  ? 'border-emerald-500/50 shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-500/30'
                  : 'border-slate-800'
              }`}
            >
              {/* Model Header */}
              <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-mono font-bold text-sm text-white">{model}</div>
                  {bestModel?.modelName === model && (
                    <span className="p-0.5 rounded bg-emerald-500/20 text-emerald-400" title="Top Performer">
                      <Trophy className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>

                {hist && (
                  <div className="text-[10px] font-mono text-slate-400" title={`Based on ${hist.total} historical checks in browser storage`}>
                    Hist. Hal: <span className="text-amber-400 font-bold">{hist.hallucinationRate}%</span>
                  </div>
                )}
              </div>

              {/* Evaluation Metrics (if evaluated) */}
              {result ? (
                <div className="p-3.5 border-b border-slate-800/80 bg-slate-900/40 space-y-2.5">
                  {/* Verdict Badge & Latency */}
                  <div className="flex items-center justify-between">
                    <div>
                      {result.verdict === 'GROUNDED' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                          <CheckCircle className="w-3 h-3 text-emerald-400" />
                          GROUNDED
                        </span>
                      ) : result.verdict === 'PARTIAL' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950/80 border border-amber-500/40 text-amber-300">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          PARTIAL
                        </span>
                      ) : result.verdict === 'UNVERIFIABLE' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 border border-amber-500/40 text-amber-300">
                          <HelpCircle className="w-3 h-3 text-amber-400" />
                          UNVERIFIABLE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300">
                          <XCircle className="w-3 h-3 text-rose-400" />
                          HALLUCINATED
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>{result.latencyMs} ms</span>
                    </div>
                  </div>

                  {/* Confidence Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono">
                      <span className="text-slate-400">Confidence Score:</span>
                      <span className="font-bold text-white">{(result.confidenceScore * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          result.confidenceScore >= threshold
                            ? 'bg-emerald-500'
                            : result.confidenceScore >= 0.5
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(5, result.confidenceScore * 100))}%` }}
                      />
                    </div>
                  </div>

                  {/* Flagged Count Ratio */}
                  <div className="flex justify-between items-center text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
                    <span>Claims Flagged:</span>
                    <span className={result.numFlagged > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {result.numFlagged} of {result.numClaims}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-slate-500 border-b border-slate-800/80 italic">
                  Not evaluated yet. Click &ldquo;Evaluate Selected Models&rdquo;.
                </div>
              )}

              {/* Model Response Editor */}
              <div className="p-3.5 flex-1 flex flex-col space-y-2">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Model Output to Verify:
                </label>
                <textarea
                  value={modelResponses[model] || ''}
                  onChange={(e) => handleUpdateResponse(model, e.target.value)}
                  rows={5}
                  placeholder={`Response generated by ${model}...`}
                  className="w-full flex-1 px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition resize-none leading-relaxed"
                />
              </div>

              {/* Flagged Claims Breakdown (if any flagged) */}
              {result && result.flaggedSpans.length > 0 && (
                <div className="p-3 bg-rose-950/20 border-t border-rose-500/20 space-y-2 text-xs">
                  <div className="font-semibold text-rose-400 flex items-center gap-1 text-[11px]">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{result.flaggedSpans.length} Unsupported Claim(s):</span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {result.flaggedSpans.map((span, sIdx) => (
                      <div key={sIdx} className="p-2 bg-rose-950/40 rounded border border-rose-500/30 text-[11px] space-y-0.5">
                        <div className="font-semibold text-rose-200">&ldquo;{span.text}&rdquo;</div>
                        <div className="text-rose-300 text-[10px]">{span.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
