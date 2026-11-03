import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle, ExternalLink, Globe, HelpCircle, Layers, XCircle } from 'lucide-react';
import { ChunkMatch, ClaimAnalysis, NLIProbabilities, WebEvidenceMatch } from '../types/groundcheck';
import { WebSearchResult } from '../services/webSearch';
import { useSearchProviderLabel } from '../services/searchProvider';

/**
 * Presentational per-claim log: status, reason, top-3 KB chunks with similarity and
 * E/N/C, the exact web query and entities, and web results with similarity and NLI.
 * Renders only data produced by the services; makes no model calls.
 */

export interface ClaimFlags {
  searchUnavailable: boolean;
  queryDegraded: boolean;
  /** NLI calls that failed for this claim (KB chunks + web snippets). */
  nliErrors: number;
}

/** Pure: derive the warning flags shown for a claim. */
export function getClaimFlags(claim: ClaimAnalysis): ClaimFlags {
  const kbErrors = claim.top3Chunks.filter((c) => c.nli.error).length;
  const webErrors = (claim.webMatches ?? []).filter((m) => m.nli?.error).length;
  return {
    searchUnavailable: Boolean(claim.webSearchError),
    queryDegraded: Boolean(claim.searchQueryDegraded),
    nliErrors: kbErrors + webErrors,
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

interface FlagChipProps {
  label: string;
  title?: string;
}

export const FlagChip: React.FC<FlagChipProps> = ({ label, title }) => (
  <span
    title={title}
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-950/70 border border-amber-500/40 text-amber-300"
  >
    <AlertTriangle className="w-3 h-3" />
    {label}
  </span>
);

interface ClaimStatusBadgeProps {
  claim: ClaimAnalysis;
}

const ClaimStatusBadge: React.FC<ClaimStatusBadgeProps> = ({ claim }) => {
  if (claim.infrastructureError) {
    return (
      <span
        title={claim.infrastructureError}
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950/80 border border-amber-500/50 text-amber-300"
      >
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        NOT VERIFIED (infrastructure)
      </span>
    );
  }
  if (claim.status === 'GROUNDED') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
        <CheckCircle className="w-3 h-3 text-emerald-400" />
        GROUNDED
      </span>
    );
  }
  if (claim.status === 'UNVERIFIABLE') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950/80 border border-amber-500/40 text-amber-300">
        <HelpCircle className="w-3 h-3 text-amber-400" />
        UNVERIFIABLE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300">
      <XCircle className="w-3 h-3 text-rose-400" />
      {claim.isContradicted
        ? `HALLUCINATED · CONTRADICTED${claim.contradictionSource ? ` (${claim.contradictionSource === 'quantity' ? 'quantity check' : 'NLI'})` : ''}`
        : 'HALLUCINATED'}
    </span>
  );
};

interface NliBreakdownProps {
  nli: NLIProbabilities;
}

/** E/N/C numbers and bar, or a visible error when the judgment failed. */
export const NliBreakdown: React.FC<NliBreakdownProps> = ({ nli }) => {
  if (nli.error) {
    return (
      <div className="text-[10px] font-mono text-amber-300 break-words" title={nli.error}>
        NLI unavailable: <span className="text-amber-200/80">{nli.error}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono text-slate-400 flex justify-between gap-2">
        <span>NLI{nli.source ? ` (${nli.source})` : ''}:</span>
        <span>
          E: {pct(nli.entailment)} | N: {pct(nli.neutral)} | C: {pct(nli.contradiction)}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-slate-800">
        <div style={{ width: `${nli.entailment * 100}%` }} className="bg-emerald-500 h-full" title={`Entailment ${pct(nli.entailment)}`} />
        <div style={{ width: `${nli.neutral * 100}%` }} className="bg-slate-500 h-full" title={`Neutral ${pct(nli.neutral)}`} />
        <div style={{ width: `${nli.contradiction * 100}%` }} className="bg-rose-500 h-full" title={`Contradiction ${pct(nli.contradiction)}`} />
      </div>
    </div>
  );
};

interface KbChunkCardProps {
  chunk: ChunkMatch;
  rank: number;
  isSupporting: boolean;
}

const KbChunkCard: React.FC<KbChunkCardProps> = ({ chunk, rank, isSupporting }) => (
  <div
    className={`p-2.5 bg-slate-900 border rounded-lg text-xs space-y-1.5 ${
      isSupporting ? 'border-emerald-500/50' : 'border-slate-800'
    }`}
  >
    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
      <span className="text-slate-400 truncate">
        #{rank}: {chunk.docTitle}
        {isSupporting && <span className="text-emerald-400"> · supporting</span>}
      </span>
      <span className="px-1.5 rounded font-bold bg-slate-800 text-slate-300 shrink-0">Sim: {chunk.similarity.toFixed(2)}</span>
    </div>
    <p className="text-[11px] text-slate-300 line-clamp-3 italic">&ldquo;{chunk.text}&rdquo;</p>
    <div className="pt-1 border-t border-slate-800/80">
      <NliBreakdown nli={chunk.nli} />
    </div>
  </div>
);

interface WebResultCardProps {
  result: WebSearchResult;
  similarity?: number;
  nli?: NLIProbabilities;
}

const WebResultCard: React.FC<WebResultCardProps> = ({ result, similarity, nli }) => (
  <div className="p-2.5 bg-slate-900/70 border border-slate-800/80 rounded-lg text-xs space-y-1.5">
    <div className="flex items-center justify-between gap-1">
      <span className="font-semibold text-slate-200 truncate">{result.title}</span>
      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5 text-[10px] shrink-0 font-mono"
        >
          <span>Link</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
    <p className="text-[11px] text-slate-300 line-clamp-3 italic">&ldquo;{result.snippet}&rdquo;</p>
    <div className="text-[10px] font-mono text-slate-500 flex flex-wrap gap-x-2">
      <span>
        Domain: <span className="text-slate-400">{result.sourceDomain}</span>
      </span>
      {similarity !== undefined && <span>Sim: {similarity.toFixed(2)}</span>}
      <span className="text-amber-400/70">lower trust</span>
    </div>
    {nli ? (
      <div className="pt-1 border-t border-slate-800/80">
        <NliBreakdown nli={nli} />
      </div>
    ) : (
      similarity !== undefined && (
        <div className="text-[10px] font-mono text-slate-600">NLI not run (outside best 3 snippets)</div>
      )
    )}
  </div>
);

interface WebEvidenceSectionProps {
  claim: ClaimAnalysis;
  webSearchEnabled: boolean;
}

const WebEvidenceSection: React.FC<WebEvidenceSectionProps> = ({ claim, webSearchEnabled }) => {
  const matches: WebEvidenceMatch[] = claim.webMatches ?? [];
  const searchLabel = useSearchProviderLabel();
  if (claim.webSkipped) {
    return (
      <div className="space-y-1.5 pt-1">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Globe className="w-3 h-3 text-cyan-400" />
          <span>Web evidence ({searchLabel}):</span>
        </div>
        <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] text-slate-500 italic">
          Skipped: the knowledge base already {claim.isContradicted ? 'contradicts' : 'supports'} this claim, so web
          evidence could not change the verdict.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Globe className="w-3 h-3 text-cyan-400" />
          <span>Web evidence ({searchLabel}):</span>
        </div>
        {webSearchEnabled && (
          <span className="text-[10px] font-mono text-slate-500 normal-case">Best web match: {pct(claim.bestWebScore)}</span>
        )}
      </div>

      {!webSearchEnabled ? (
        <div className="text-[11px] text-slate-500 italic">Web search was disabled for this check.</div>
      ) : (
        <>
          {claim.searchQuery !== undefined && (
            <div className="text-[10px] font-mono text-slate-400 break-words space-y-1">
              <div>
                Query sent: <span className="text-slate-200">&ldquo;{claim.searchQuery}&rdquo;</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span>Entities:</span>
                {claim.searchEntities && claim.searchEntities.length > 0 ? (
                  claim.searchEntities.map((e) => (
                    <span key={e} className="px-1.5 rounded bg-cyan-950/70 border border-cyan-500/30 text-cyan-300">
                      {e}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500">none appended</span>
                )}
              </div>
              {claim.searchQueryDegraded && (
                <div className="text-amber-300">
                  Query degraded: claim only{claim.searchQueryError ? ` (${claim.searchQueryError})` : ''}
                </div>
              )}
            </div>
          )}

          {claim.webSearchError && (
            <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-300 break-words">
              Search unavailable: {claim.webSearchError}
            </div>
          )}
          {claim.webEchoesDiscarded !== undefined && claim.webEchoesDiscarded > 0 && (
            <div className="text-[10px] font-mono text-slate-500">
              {claim.webEchoesDiscarded} snippet(s) discarded for restating the claim/query.
            </div>
          )}

          {matches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {matches.map((m) => (
                <WebResultCard key={m.result.url} result={m.result} similarity={m.similarity} nli={m.nli} />
              ))}
            </div>
          ) : claim.webResults.length > 0 ? (
            // Records saved before web scoring existed: show the raw results only.
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {claim.webResults.map((r) => (
                <WebResultCard key={r.url} result={r} />
              ))}
            </div>
          ) : (
            !claim.webSearchError && (
              <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] text-slate-500 italic">
                No grounded web sources returned for this claim.
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};

export interface ClaimLogCardProps {
  claim: ClaimAnalysis;
  /** 1-based position of the claim in the response. */
  index: number;
  /** Whether web search was enabled for the check this claim belongs to. */
  webSearchEnabled: boolean;
}

export const ClaimLogCard: React.FC<ClaimLogCardProps> = ({ claim, index, webSearchEnabled }) => {
  const flags = getClaimFlags(claim);
  return (
    <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-xl space-y-3 transition hover:border-slate-700">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-2.5 border-b border-slate-800/80">
        <div className="space-y-0.5 min-w-0">
          <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Claim #{index}</span>
          <div className="text-sm font-semibold text-slate-100 break-words">&ldquo;{claim.text}&rdquo;</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 self-start shrink-0">
          <ClaimStatusBadge claim={claim} />
          {flags.searchUnavailable && <FlagChip label="Search unavailable" title={claim.webSearchError} />}
          {flags.queryDegraded && <FlagChip label="Query degraded" title={claim.searchQueryError} />}
          {flags.nliErrors > 0 && <FlagChip label={`NLI error ×${flags.nliErrors}`} />}
        </div>
      </div>

      {claim.infrastructureError ? (
        <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-xs text-amber-300 break-words">
          Not verified: an upstream call this claim depended on failed, so no verdict is given.{' '}
          <span className="font-mono text-amber-200/80">{claim.infrastructureError}</span>
        </div>
      ) : (
        <div className="text-xs text-slate-300 flex items-start gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span className="break-words">{claim.statusReason}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Layers className="w-3 h-3 text-blue-400" />
          <span>Top 3 knowledge base chunks (similarity + NLI):</span>
        </div>
        {claim.top3Chunks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {claim.top3Chunks.map((chunk, i) => (
              <KbChunkCard
                key={chunk.chunkId}
                chunk={chunk}
                rank={i + 1}
                isSupporting={claim.supportingChunkId === chunk.chunkId}
              />
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 italic">Knowledge base is empty.</div>
        )}
      </div>

      <WebEvidenceSection claim={claim} webSearchEnabled={webSearchEnabled} />
    </div>
  );
};
