import React, { useState } from 'react';
import {
  Eye,
  ShieldAlert,
  CheckCircle,
  Code,
  ChevronRight,
  FileText,
  ArrowRight,
  Globe,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { CheckRecord, KnowledgeBaseDoc } from '../types/groundcheck';

interface DrillDownInspectorProps {
  checks: CheckRecord[];
  selectedCheckId: string | null;
  onSelectCheck: (checkId: string) => void;
  kbDocs: KnowledgeBaseDoc[];
}

export const DrillDownInspector: React.FC<DrillDownInspectorProps> = ({
  checks,
  selectedCheckId,
  onSelectCheck,
  kbDocs,
}) => {
  const [filterOnlyFlagged, setFilterOnlyFlagged] = useState(true);
  const [jsonView, setJsonView] = useState(false);

  // Eligible checks for the dropdown
  const selectableChecks = filterOnlyFlagged
    ? checks.filter((c) => c.verdict !== 'GROUNDED')
    : checks;

  // Selected check row
  const activeCheck = checks.find((c) => c.checkId === selectedCheckId) || selectableChecks[0] || checks[0];

  if (!activeCheck) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500">
        No checks available to inspect.
      </div>
    );
  }

  // Find related source documents
  const relatedDocs = kbDocs.filter((doc) =>
    activeCheck.sourceDocIds?.includes(doc.docId) ||
    activeCheck.flaggedSpans?.some((span) => span.closestDocId === doc.docId)
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      {/* Title & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base lg:text-lg font-bold text-white flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400" />
            <span>Drill into a flagged response</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Inspect individual sentence claims, groundedness scores, and ground truth document sources
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filterOnlyFlagged}
              onChange={(e) => setFilterOnlyFlagged(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-cyan-500/20"
            />
            <span>Filter flagged only</span>
          </label>

          <button
            onClick={() => setJsonView(!jsonView)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono transition border ${
              jsonView
                ? 'bg-purple-950 border-purple-500/50 text-purple-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Raw JSON</span>
          </button>
        </div>
      </div>

      {/* Select Box (Matches Streamlit format: {cid[:8]}... — {VERDICT}) */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Select a check to inspect
        </label>
        <select
          value={activeCheck.checkId}
          onChange={(e) => onSelectCheck(e.target.value)}
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 transition"
        >
          {selectableChecks.map((c) => (
            <option key={c.checkId} value={c.checkId}>
              {c.checkId.substring(0, 8)}... — {c.verdict} ({c.modelName}) — {c.prompt.substring(0, 50)}...
            </option>
          ))}
        </select>
      </div>

      {/* Check Details Card */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 lg:p-5 space-y-4">
        {/* Meta Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">CHECK_ID:</span>
            <span className="text-cyan-400 font-bold">{activeCheck.checkId}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400">MODEL:</span>
            <span className="text-slate-200">{activeCheck.modelName}</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">VERDICT:</span>
            <span
              className={`font-bold ${
                activeCheck.verdict === 'GROUNDED'
                  ? 'text-emerald-400'
                  : activeCheck.verdict === 'PARTIAL'
                  ? 'text-amber-400'
                  : activeCheck.verdict === 'UNVERIFIABLE'
                  ? 'text-amber-300'
                  : 'text-rose-400'
              }`}
            >
              {activeCheck.verdict}
              {activeCheck.verdict === 'UNVERIFIABLE' && ' (Not covered by KB)'}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">CONFIDENCE:</span>
            <span className="text-slate-200">{activeCheck.confidenceScore.toFixed(4)}</span>
          </div>
        </div>

        {/* Prompt */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Prompt:
          </div>
          <div className="p-3 bg-slate-900 border border-slate-800/80 rounded-lg text-sm text-slate-200">
            {activeCheck.prompt}
          </div>
        </div>

        {/* Response with Visual Highlights */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Response:
          </div>
          <div className="p-3 bg-slate-900 border border-slate-800/80 rounded-lg text-sm text-slate-200 leading-relaxed">
            {activeCheck.response}
          </div>
        </div>

        {/* Flagged Spans */}
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Flagged spans:</span>
          </div>

          {jsonView ? (
            /* Streamlit st.json equivalent */
            <pre className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg font-mono text-xs text-cyan-300 overflow-x-auto max-h-64">
              {JSON.stringify(activeCheck.flaggedSpans || [], null, 2)}
            </pre>
          ) : activeCheck.flaggedSpans && activeCheck.flaggedSpans.length > 0 ? (
            <div className="space-y-2">
              {activeCheck.flaggedSpans.map((span, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-rose-950/20 border border-rose-500/30 rounded-lg text-xs space-y-1.5"
                >
                  <div className="font-semibold text-rose-200 text-sm">
                    &ldquo;{span.text}&rdquo;
                  </div>
                  <div className="text-rose-300 flex items-center gap-1.5">
                    <ArrowRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>{span.reason}</span>
                  </div>
                  <div className="pt-1 text-[11px] text-slate-400 flex items-center justify-between border-t border-rose-500/20">
                    <div>
                      Source Document: <strong className="text-slate-200">{span.closestDocTitle}</strong> ({span.closestDocId})
                    </div>
                    <div className="font-mono">
                      Similarity Score: <span className="text-rose-400 font-bold">{span.score.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>No unsupported spans flagged in this check. Output fully grounded in source documents.</span>
            </div>
          )}
        </div>

        {/* Explicit Citations & Reference Documents Cited */}
        {activeCheck.citations && activeCheck.citations.length > 0 && (
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                <span>Explicit Citations &amp; Reference Documents:</span>
              </div>
              {activeCheck.usedWebSearch && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 border border-cyan-500/40 text-cyan-300">
                  <Globe className="w-3 h-3 text-cyan-400" />
                  Web Search Grounding Utilized
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activeCheck.citations.map((cite, cIdx) => (
                <div
                  key={cIdx}
                  className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                        cite.sourceType === 'web'
                          ? 'bg-cyan-950 border border-cyan-500/40 text-cyan-300'
                          : 'bg-blue-950 border border-blue-500/40 text-blue-300'
                      }`}
                    >
                      {cite.sourceType === 'web' ? (
                        <>
                          <Globe className="w-3 h-3 text-cyan-400" />
                          Web Search Reference
                        </>
                      ) : (
                        <>
                          <FileText className="w-3 h-3 text-blue-400" />
                          Exasol KB Local Doc
                        </>
                      )}
                    </span>

                    <span className="text-[10px] font-mono text-emerald-400 font-bold">
                      {(cite.similarityScore * 100).toFixed(0)}% match
                    </span>
                  </div>

                  <div className="font-semibold text-slate-100 flex items-center justify-between gap-1">
                    <span>{cite.title}</span>
                    {cite.url && (
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5 text-[11px] shrink-0"
                      >
                        <span>View Source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-300 italic bg-slate-950/70 p-2 rounded border border-slate-800/80 line-clamp-3">
                    &ldquo;{cite.snippet}&rdquo;
                  </p>

                  <div className="text-[10px] font-mono text-slate-500 truncate">
                    Source: <span className="text-slate-400">{cite.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matched Ground Truth Source Documents */}
        {relatedDocs.length > 0 && (
          <div className="pt-2 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-blue-400" />
              <span>Matched Ground Truth Documents (from Exasol KNOWLEDGE_BASE):</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {relatedDocs.map((doc) => (
                <div
                  key={doc.docId}
                  className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-100">{doc.title}</span>
                    <span className="font-mono text-[10px] text-slate-500">{doc.docId}</span>
                  </div>
                  <p className="text-slate-300 text-[11px] line-clamp-3 italic">
                    &ldquo;{doc.content}&rdquo;
                  </p>
                  <div className="text-[10px] text-cyan-400 font-mono">
                    Source: {doc.source}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
