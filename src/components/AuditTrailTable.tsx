import React, { useState } from 'react';
import { Search, Filter, ExternalLink, Download, FileSpreadsheet, Check, CheckCircle2, ChevronDown, X, Globe } from 'lucide-react';
import { CheckRecord, Verdict } from '../types/groundcheck';

interface AuditTrailTableProps {
  checks: CheckRecord[];
  selectedCheckId: string | null;
  onSelectCheck: (checkId: string) => void;
}

export const AuditTrailTable: React.FC<AuditTrailTableProps> = ({
  checks,
  selectedCheckId,
  onSelectCheck,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL');
  const [modelFilter, setModelFilter] = useState<string>('ALL');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Unique models for filter
  const models = Array.from(new Set(checks.map((c) => c.modelName)));

  // Filtered list: filter by text search (prompt text or model name), verdict, and model dropdown
  const filtered = checks.filter((c) => {
    if (verdictFilter !== 'ALL' && c.verdict !== verdictFilter) return false;
    if (modelFilter !== 'ALL' && c.modelName !== modelFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchPrompt = c.prompt.toLowerCase().includes(q);
      const matchModel = c.modelName.toLowerCase().includes(q);
      const matchResponse = c.response.toLowerCase().includes(q);
      const matchId = c.checkId.toLowerCase().includes(q);
      if (!matchPrompt && !matchModel && !matchResponse && !matchId) return false;
    }
    return true;
  });

  const getVerdictStyle = (verdict: Verdict) => {
    switch (verdict) {
      case 'GROUNDED':
        return 'text-emerald-400 bg-emerald-950/70 border-emerald-500/30';
      case 'PARTIAL':
        return 'text-amber-400 bg-amber-950/70 border-amber-500/30';
      case 'UNVERIFIABLE':
        return 'text-amber-300 bg-amber-950/70 border-amber-500/40';
      case 'HALLUCINATED':
        return 'text-rose-400 bg-rose-950/70 border-rose-500/30';
    }
  };

  /**
   * RFC 4180 compliant CSV field escaper
   */
  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  /**
   * Export records to CSV for external compliance records.
   * Includes UTF-8 BOM (\uFEFF) for immediate compatibility with Excel, LibreOffice, and enterprise GRC tools.
   */
  const triggerCsvDownload = (recordsToExport: CheckRecord[], exportType: 'filtered' | 'all') => {
    const headers = [
      'CHECK_ID',
      'CREATED_AT_UTC',
      'MODEL_NAME',
      'VERDICT',
      'CONFIDENCE_SCORE',
      'CLAIMS_TOTAL',
      'CLAIMS_FLAGGED',
      'FLAGGED_REASONS_SUMMARY',
      'SOURCE_DOC_IDS',
      'CITED_SOURCES_AND_REFERENCES',
      'USED_WEB_SEARCH',
      'LATENCY_MS',
      'PROMPT',
      'RESPONSE',
    ];

    const rows = recordsToExport.map((c) => {
      // Summarize flagged spans
      const flaggedReasons = (c.flaggedSpans || [])
        .map((s, idx) => `[${idx + 1}] "${s.text}" => ${s.reason}`)
        .join('; ');

      const sourceDocs = (c.sourceDocIds || []).join(', ');

      const citedSummary = (c.citations || [])
        .map((ci) => `[${ci.sourceType.toUpperCase()}] ${ci.title} (${ci.url || ci.source})`)
        .join('; ');

      return [
        escapeCsv(c.checkId),
        escapeCsv(c.createdAt),
        escapeCsv(c.modelName),
        escapeCsv(c.verdict),
        escapeCsv(c.confidenceScore.toFixed(4)),
        escapeCsv(c.claimsAnalysis ? c.claimsAnalysis.length : ''), // real claim count; blank for records saved without a claim log
        escapeCsv(c.flaggedSpans?.length || 0),
        escapeCsv(flaggedReasons || 'None (fully grounded)'),
        escapeCsv(sourceDocs || 'N/A'),
        escapeCsv(citedSummary || 'N/A'),
        escapeCsv(c.usedWebSearch ? 'YES' : 'NO'),
        escapeCsv(c.latencyMs.toFixed(2)),
        escapeCsv(c.prompt),
        escapeCsv(c.response),
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `groundcheck_compliance_audit_${exportType}_${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShowExportMenu(false);
    setExportNotice(`Exported ${recordsToExport.length} audit records to ${filename}`);
    setTimeout(() => setExportNotice(null), 4500);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base lg:text-lg font-bold text-white flex items-center gap-2">
            <span>Audit trail — every check, stored in this browser</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Append-only log in browser local storage (mirrors the Exasol <code className="text-cyan-400 font-mono">CHECKS</code> schema) ({filtered.length} of {checks.length} records shown)
          </p>
        </div>

        {/* Export action with compliance options */}
        <div className="relative self-start lg:self-auto">
          <div className="inline-flex rounded-lg shadow-sm">
            <button
              onClick={() => triggerCsvDownload(filtered, 'filtered')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg bg-cyan-700/80 hover:bg-cyan-600 border border-cyan-600/50 text-xs font-medium text-white transition active:scale-[0.99] cursor-pointer"
              title="Export current filtered view to CSV for compliance audits"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-2 py-1.5 rounded-r-lg bg-cyan-800/80 hover:bg-cyan-700 border-y border-r border-cyan-600/50 text-xs text-cyan-200 transition"
              title="More export options"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Export Dropdown Menu */}
          {showExportMenu && (
            <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-2 space-y-1 text-xs animate-in fade-in zoom-in-95">
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                Compliance CSV Export
              </div>
              <button
                onClick={() => triggerCsvDownload(filtered, 'filtered')}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white flex items-start gap-2 transition"
              >
                <Download className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-white">Export Filtered View ({filtered.length} checks)</div>
                  <div className="text-[11px] text-slate-400">Respects active search, model, and verdict filters.</div>
                </div>
              </button>
              <button
                onClick={() => triggerCsvDownload(checks, 'all')}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white flex items-start gap-2 transition"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-white">Export Full Audit Log ({checks.length} checks)</div>
                  <div className="text-[11px] text-slate-400">Complete historical dataset including all models and prompts.</div>
                </div>
              </button>
              <div className="px-2 py-1.5 text-[10px] text-slate-500 border-t border-slate-800 font-mono">
                Includes RFC 4180 escaping, UTF-8 BOM for Excel, latency ms, confidence scores &amp; flagged reasons.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Export notification toast */}
      {exportNotice && (
        <div className="p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{exportNotice}</span>
          </div>
          <button
            onClick={() => setExportNotice(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Text Search Input Field at Top of Table */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          {/* Main Text Search Input: Filter by Prompt Text or Model Name */}
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-cyan-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by prompt text or model name (e.g. 'refund', 'gpt-4o')..."
              className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition shadow-inner"
              aria-label="Filter audit logs by prompt text or model name"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white transition"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Verdict Filter */}
          <div className="md:col-span-3">
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              aria-label="Filter by verdict"
            >
              <option value="ALL">All Verdicts</option>
              <option value="GROUNDED">Grounded Only</option>
              <option value="PARTIAL">Partial Only</option>
              <option value="UNVERIFIABLE">Unverifiable Only (Not Covered)</option>
              <option value="HALLUCINATED">Hallucinated Only</option>
            </select>
          </div>

          {/* Model Filter */}
          <div className="md:col-span-3">
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              aria-label="Filter by model"
            >
              <option value="ALL">All Models</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filter Indicators */}
        {(searchQuery.trim() || verdictFilter !== 'ALL' || modelFilter !== 'ALL') && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-slate-400 font-mono text-[11px]">Active Filters:</span>
            {searchQuery.trim() && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-mono text-[11px]">
                Search: &ldquo;{searchQuery}&rdquo;
                <button
                  onClick={() => setSearchQuery('')}
                  className="hover:text-white"
                  title="Remove query"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {verdictFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px]">
                Verdict: {verdictFilter}
                <button
                  onClick={() => setVerdictFilter('ALL')}
                  className="hover:text-white"
                  title="Remove verdict filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {modelFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px]">
                Model: {modelFilter}
                <button
                  onClick={() => setModelFilter('ALL')}
                  className="hover:text-white"
                  title="Remove model filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setVerdictFilter('ALL');
                setModelFilter('ALL');
              }}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline ml-1"
            >
              Reset all filters
            </button>
          </div>
        )}
      </div>

      {/* Table view */}
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-2.5 px-3">CREATED_AT</th>
              <th className="py-2.5 px-3">MODEL_NAME</th>
              <th className="py-2.5 px-3">VERDICT</th>
              <th className="py-2.5 px-3 text-right">CONFIDENCE_SCORE</th>
              <th className="py-2.5 px-3 text-right">LATENCY_MS</th>
              <th className="py-2.5 px-3">PROMPT</th>
              <th className="py-2.5 px-3 text-center">ACTION</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Search className="w-6 h-6 text-slate-600" />
                    <div>
                      {searchQuery.trim()
                        ? `No audit logs found matching "${searchQuery}" in prompt text or model name.`
                        : checks.length === 0
                        ? 'No checks yet. Run a verification to start the audit trail.'
                        : 'No checks match the current filters.'}
                    </div>
                    {searchQuery.trim() && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-xs text-cyan-400 hover:text-cyan-300 underline font-sans"
                      >
                        Clear search input
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const isSelected = c.checkId === selectedCheckId;
                return (
                  <tr
                    key={c.checkId}
                    onClick={() => onSelectCheck(c.checkId)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? 'bg-cyan-950/40 border-l-2 border-cyan-500'
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                      {c.createdAt.replace('T', ' ').substring(0, 19)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-200 font-semibold whitespace-nowrap">
                      {c.modelName}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${getVerdictStyle(
                            c.verdict
                          )}`}
                        >
                          {c.verdict}
                        </span>
                        {c.usedWebSearch && (
                          <span
                            className="text-cyan-400"
                            title="Web search grounding was utilized for this verification"
                          >
                            <Globe className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200 whitespace-nowrap">
                      {c.confidenceScore.toFixed(4)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400 whitespace-nowrap">
                      {c.latencyMs} ms
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-sans max-w-xs truncate" title={c.prompt}>
                      {c.prompt}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCheck(c.checkId);
                        }}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 font-sans hover:underline flex items-center justify-center gap-1 mx-auto"
                      >
                        <span>Inspect</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
