import React from 'react';
import { Layers, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import { CheckRecord } from '../types/groundcheck';

interface MetricsOverviewProps {
  checks: CheckRecord[];
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({ checks }) => {
  const total = checks.length;
  const grounded = checks.filter((c) => c.verdict === 'GROUNDED').length;
  const partial = checks.filter((c) => c.verdict === 'PARTIAL').length;
  const unverifiable = checks.filter((c) => c.verdict === 'UNVERIFIABLE').length;
  const hallucinated = checks.filter((c) => c.verdict === 'HALLUCINATED').length;

  const hallucinationRate = total > 0 ? Math.round((hallucinated / total) * 100) : 0;
  const groundedRate = total > 0 ? Math.round((grounded / total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-3.5">
      {/* Metric 1: Total Checks */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Total Checks</span>
          <Layers className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-white tracking-tight">
            {total}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Stored in browser local storage
          </p>
        </div>
      </div>

      {/* Metric 2: Grounded */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Grounded</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-emerald-400 tracking-tight flex items-baseline gap-2">
            <span>{grounded}</span>
            <span className="text-xs font-normal text-emerald-500/80">({groundedRate}%)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Supported claims
          </p>
        </div>
      </div>

      {/* Metric 3: Partial */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Partial</span>
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-amber-400 tracking-tight flex items-baseline gap-2">
            <span>{partial}</span>
            <span className="text-xs font-normal text-amber-500/80">
              ({total > 0 ? Math.round((partial / total) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Mixed status claims
          </p>
        </div>
      </div>

      {/* Metric 4: Unverifiable (Amber - Not covered by KB) */}
      <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4 flex flex-col justify-between bg-gradient-to-b from-amber-950/20 to-slate-900">
        <div className="flex items-center justify-between text-amber-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Unverifiable</span>
          <HelpCircle className="w-4 h-4 text-amber-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-amber-300 tracking-tight flex items-baseline gap-2">
            <span>{unverifiable}</span>
            <span className="text-xs font-normal text-amber-400/80">
              ({total > 0 ? Math.round((unverifiable / total) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[11px] text-amber-300/70 mt-0.5">
            Not covered by KB (&lt;0.30)
          </p>
        </div>
      </div>

      {/* Metric 5: Hallucinated */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider">Hallucinated</span>
          <XCircle className="w-4 h-4 text-rose-400" />
        </div>
        <div className="mt-2">
          <div className="text-2xl font-bold font-mono text-rose-400 tracking-tight flex items-baseline gap-2">
            <span>{hallucinated}</span>
            <span className="text-xs font-normal text-rose-500/80">({hallucinationRate}%)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Contradicted or covered topic unsupported
          </p>
        </div>
      </div>
    </div>
  );
};
