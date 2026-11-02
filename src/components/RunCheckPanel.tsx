import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Play,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Clock,
  ShieldAlert,
  Globe,
  ExternalLink,
  FileText,
  BookOpen,
  HelpCircle,
  Activity,
  Layers,
} from 'lucide-react';
import { VerificationResult, Verdict } from '../types/groundcheck';

interface RunCheckPanelProps {
  onRunCheck: (
    prompt: string,
    response: string,
    modelName: string,
    enableWebSearch: boolean
  ) => Promise<VerificationResult | null>;
  isVerifying: boolean;
  latestResult: VerificationResult | null;
  latestResponseText: string;
}

const PRESET_EXAMPLES = [
  {
    name: '❌ Hallucinated (Refund Conflict)',
    prompt: 'What is our refund policy for electronics and digital downloads?',
    modelName: 'gpt-4o',
    response:
      'Refunds are issued within 30 days, no questions asked. Digital products can also be refunded at any time as long as you provide the license key.',
  },
  {
    name: '⚡ Unverifiable (Not in KB)',
    prompt: 'What was the population of Tokyo in 1920?',
    modelName: 'gpt-4o',
    response:
      'The population of Tokyo in 1920 was approximately 3.7 million residents.',
  },
  {
    name: '✅ Grounded (Shipping Policy)',
    prompt: 'How long does standard delivery take and is there free shipping?',
    modelName: 'claude-3-5-sonnet',
    response:
      'Standard shipping takes 3 to 5 business days within the country and is free on orders above 999 rupees. Tracking information is emailed to the customer once the order ships.',
  },
  {
    name: '⚠️ Partial (Mixed Shipping & Returns)',
    prompt: 'Can you summarize our returns and shipping terms?',
    modelName: 'gemini-1.5-pro',
    response:
      'Standard shipping takes 3 to 5 business days. Express shipping delivers within 1 to 2 business days. Customers can also return items within 60 days even without receipt.',
  },
  {
    name: '🌐 Web Fallback: GDPR Data Erasure',
    prompt: 'What are an organization\'s obligations under GDPR Article 17 regarding user data erasure?',
    modelName: 'claude-3-5-sonnet',
    response:
      'Under Article 17 of GDPR, organizations must erase personal data without undue delay upon valid request, typically within 30 days.',
  },
];

const MODEL_OPTIONS = ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro', 'llama-3-70b', 'mistral-large'];

export const RunCheckPanel: React.FC<RunCheckPanelProps> = ({
  onRunCheck,
  isVerifying,
  latestResult,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [prompt, setPrompt] = useState(PRESET_EXAMPLES[0].prompt);
  const [modelName, setModelName] = useState(PRESET_EXAMPLES[0].modelName);
  const [response, setResponse] = useState(PRESET_EXAMPLES[0].response);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleApplyPreset = (preset: (typeof PRESET_EXAMPLES)[0]) => {
    setPrompt(preset.prompt);
    setModelName(preset.modelName);
    setResponse(preset.response);
    setValidationError(null);
  };

  const handleVerify = async () => {
    if (!prompt.trim() || !response.trim()) {
      setValidationError('Enter both a prompt and an LLM response.');
      return;
    }
    setValidationError(null);
    await onRunCheck(
      prompt.trim(),
      response.trim(),
      modelName.trim() || 'unspecified',
      enableWebSearch
    );
  };

  const getVerdictBadge = (verdict: Verdict) => {
    switch (verdict) {
      case 'GROUNDED':
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 text-sm font-semibold tracking-wide uppercase">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            GROUNDED
          </div>
        );
      case 'PARTIAL':
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-amber-300 bg-amber-950/80 border border-amber-500/40 text-sm font-semibold tracking-wide uppercase">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            PARTIAL
          </div>
        );
      case 'UNVERIFIABLE':
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-amber-300 bg-amber-950/80 border border-amber-500/40 text-sm font-semibold tracking-wide">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <span className="font-bold uppercase">UNVERIFIABLE</span>
            <span className="text-xs text-amber-300/90 font-normal">
              — Not covered by the knowledge base
            </span>
          </div>
        );
      case 'HALLUCINATED':
        return (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-rose-300 bg-rose-950/80 border border-rose-500/40 text-sm font-semibold tracking-wide uppercase">
            <XCircle className="w-4 h-4 text-rose-400" />
            HALLUCINATED
          </div>
        );
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-lg overflow-hidden transition-all">
      {/* Header / Accordion toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-5 py-3.5 bg-slate-800/60 hover:bg-slate-800 border-b border-slate-800/80 flex items-center justify-between text-left transition"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-slate-100 text-sm lg:text-base">Run a new check</span>
          <span className="text-xs text-slate-400 font-normal">
            (Verify prompt &amp; LLM response with Top 3 Chunks NLI &amp; Web Fallback)
          </span>
        </div>
        <div className="text-slate-400 hover:text-slate-200">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-5 space-y-4">
          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Demo Presets:</span>
            {PRESET_EXAMPLES.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleApplyPreset(p)}
                className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Form Columns (Prompt & Model / Response) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1: Prompt & Model */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What is our refund policy?"
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Model name
                </label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {MODEL_OPTIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModelName(m)}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded border transition ${
                          modelName === m
                            ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: LLM Response */}
            <div className="flex flex-col">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                LLM response to verify
              </label>
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Paste or type the model's response here..."
                rows={7}
                className="w-full flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition resize-none"
              />
            </div>
          </div>

          {/* Web Search Fallback Configuration Toggle */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-cyan-950 border border-cyan-500/40 text-cyan-400">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <div className="font-semibold text-slate-200 flex items-center gap-2">
                  <span>Web Search Fallback</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-500/30">
                    Live Retrieval
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Perform live external web search if information is missing from the local Exasol database. If neither is found, status becomes UNVERIFIABLE (&ldquo;Not covered by the knowledge base&rdquo;).
                </div>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer self-start sm:self-auto">
              <input
                type="checkbox"
                checked={enableWebSearch}
                onChange={(e) => setEnableWebSearch(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              <span className="ml-2 text-xs font-mono font-medium text-slate-300">
                {enableWebSearch ? 'ENABLED' : 'DISABLED'}
              </span>
            </label>
          </div>

          {/* Validation Error Message */}
          {validationError && (
            <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-1 flex items-center justify-between flex-wrap gap-3">
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg shadow-md shadow-cyan-600/20 flex items-center gap-2 transition active:scale-[0.99] cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Evaluating NLI on Top 3 Chunks &amp; Web...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Verify against knowledge base</span>
                </>
              )}
            </button>

            <span className="text-xs text-slate-500 font-mono">
              Auto-logs Top 3 Chunks, NLI Probabilities &amp; Web Results to Exasol
            </span>
          </div>

          {/* Live Result Output */}
          {latestResult && (
            <div className="mt-4 pt-4 border-t border-slate-800 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Verdict Summary Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Verdict:
                  </span>
                  {getVerdictBadge(latestResult.verdict)}

                  {latestResult.usedWebSearch && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                      <Globe className="w-3 h-3 text-cyan-400" />
                      <span>Web Search Used</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs font-mono text-slate-300">
                  <div>
                    Confidence score: <strong className="text-white text-sm">{latestResult.confidenceScore}</strong>
                  </div>
                  <div className="text-slate-500">•</div>
                  <div>
                    Claims analyzed: <strong className="text-white">{latestResult.numClaims}</strong>
                  </div>
                  <div className="text-slate-500">•</div>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{latestResult.latencyMs} ms</span>
                  </div>
                </div>
              </div>

              {/* Per-Claim Detailed NLI, Top 3 Chunks & Web Results Log Panel */}
              {latestResult.claimsAnalysis && latestResult.claimsAnalysis.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-cyan-400" />
                      <span>Per-Claim Top 3 Chunks, NLI Probabilities &amp; Web Results:</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      Top 3 chunks evaluated for every claim
                    </span>
                  </div>

                  <div className="space-y-3">
                    {latestResult.claimsAnalysis.map((claimItem, cIdx) => (
                      <div
                        key={claimItem.claimId}
                        className="p-4 bg-slate-950/90 border border-slate-800 rounded-xl space-y-3 transition hover:border-slate-700"
                      >
                        {/* Claim Header & Status */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                          <div className="space-y-0.5">
                            <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                              Claim #{cIdx + 1}
                            </span>
                            <div className="text-sm font-semibold text-slate-100">
                              &ldquo;{claimItem.text}&rdquo;
                            </div>
                          </div>

                          <div className="self-start sm:self-auto shrink-0">
                            {claimItem.status === 'GROUNDED' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                                <CheckCircle className="w-3 h-3 text-emerald-400" />
                                GROUNDED
                              </span>
                            ) : claimItem.status === 'UNVERIFIABLE' ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-950/80 border border-amber-500/40 text-amber-300">
                                <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                                <span className="font-bold">UNVERIFIABLE</span>
                                <span className="text-[11px] text-amber-300/80">
                                  — Not covered by the knowledge base
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300">
                                <XCircle className="w-3 h-3 text-rose-400" />
                                HALLUCINATED
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status Reason */}
                        <div className="text-xs text-slate-300 flex items-center gap-1.5">
                          <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>{claimItem.statusReason}</span>
                        </div>

                        {/* Top 3 Knowledge Base Chunks with Similarity Scores */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <Layers className="w-3 h-3 text-blue-400" />
                            <span>Top 3 Knowledge Base Chunks (Similarity Scores):</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            {claimItem.top3Chunks.map((chunk, chkIdx) => (
                              <div
                                key={chunk.chunkId}
                                className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span className="text-slate-400">
                                    Chunk #{chkIdx + 1}: {chunk.docTitle}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.2 rounded font-bold ${
                                      chunk.similarity >= 0.60
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                        : chunk.similarity >= 0.30
                                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/30'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    Sim: {chunk.similarity.toFixed(2)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-300 line-clamp-3 italic">
                                  &ldquo;{chunk.text}&rdquo;
                                </p>

                                {/* Per-chunk NLI Probabilities */}
                                <div className="pt-1 border-t border-slate-800/80 space-y-1">
                                  <div className="text-[10px] font-mono text-slate-400 flex justify-between">
                                    <span>NLI:</span>
                                    <span>
                                      E: {(chunk.nli.entailment * 100).toFixed(0)}% | N:{' '}
                                      {(chunk.nli.neutral * 100).toFixed(0)}% | C:{' '}
                                      {(chunk.nli.contradiction * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-slate-800">
                                    <div
                                      style={{ width: `${chunk.nli.entailment * 100}%` }}
                                      className="bg-emerald-500 h-full"
                                      title={`Entailment: ${(chunk.nli.entailment * 100).toFixed(1)}%`}
                                    />
                                    <div
                                      style={{ width: `${chunk.nli.neutral * 100}%` }}
                                      className="bg-slate-500 h-full"
                                      title={`Neutral: ${(chunk.nli.neutral * 100).toFixed(1)}%`}
                                    />
                                    <div
                                      style={{ width: `${chunk.nli.contradiction * 100}%` }}
                                      className="bg-rose-500 h-full"
                                      title={`Contradiction: ${(chunk.nli.contradiction * 100).toFixed(1)}%`}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Web Results for this Claim */}
                        <div className="space-y-1.5 pt-1">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <Globe className="w-3 h-3 text-cyan-400" />
                              <span>Web Search Results for Claim:</span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500">
                              Best Web Match: {(claimItem.bestWebScore * 100).toFixed(0)}%
                            </span>
                          </div>

                          {claimItem.webResults && claimItem.webResults.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {claimItem.webResults.slice(0, 2).map((web, wIdx) => (
                                <div
                                  key={wIdx}
                                  className="p-2.5 bg-slate-900/70 border border-slate-800/80 rounded-lg text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-semibold text-slate-200 truncate">
                                      {web.title}
                                    </span>
                                    {web.url && (
                                      <a
                                        href={web.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5 text-[10px] shrink-0 font-mono"
                                      >
                                        <span>Link</span>
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-300 line-clamp-2 italic">
                                    &ldquo;{web.snippet}&rdquo;
                                  </p>
                                  <div className="text-[10px] font-mono text-slate-500">
                                    Domain: <span className="text-slate-400">{web.sourceDomain}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] text-slate-500 italic">
                              No external web results retrieved for this claim.
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
