import React, { useState } from 'react';
import { Database, BookOpen, Sliders, RotateCcw, Code, CheckCircle2 } from 'lucide-react';
import { KnowledgeBaseDoc } from '../types/groundcheck';

interface HeaderProps {
  threshold: number;
  onUpdateThreshold: (newVal: number) => void;
  kbDocs: KnowledgeBaseDoc[];
  onOpenKb: () => void;
  onOpenSchema: () => void;
  onResetData: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  threshold,
  onUpdateThreshold,
  kbDocs,
  onOpenKb,
  onOpenSchema,
  onResetData,
}) => {
  const [showThresholdEdit, setShowThresholdEdit] = useState(false);
  const [tempThreshold, setTempThreshold] = useState(threshold.toString());

  const handleSaveThreshold = () => {
    const parsed = parseFloat(tempThreshold);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 1) {
      onUpdateThreshold(parsed);
      setShowThresholdEdit(false);
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-8 py-3.5 transition-colors">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-md shadow-cyan-500/20">
              G
            </div>
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              GroundCheck <span className="text-slate-500 font-light">/</span> AuditLens
            </h1>
          </div>
          <p className="text-xs lg:text-sm text-slate-400 mt-0.5 flex items-center gap-2">
            <span>LLM output verification &amp; audit-trail layer</span>
            <span className="w-1 h-1 rounded-full bg-slate-600"></span>
            <span className="text-cyan-400 font-medium inline-flex items-center gap-1">
              <Database className="w-3.5 h-3.5" /> Exasol-ready schema
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Records are stored in this browser&apos;s local storage; no Exasol connection is configured yet.
          </p>
        </div>

        {/* Right Badges & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Storage backend badge (accurate: data lives in browser localStorage) */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-600/50 text-slate-300 text-xs font-mono font-medium"
            title="Knowledge base and audit records are kept in this browser's localStorage. They are not shared and are lost if site data is cleared."
          >
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span>Local storage (browser)</span>
          </div>

          {/* Threshold setting */}
          <div className="relative">
            <button
              onClick={() => {
                setTempThreshold(threshold.toString());
                setShowThresholdEdit(!showThresholdEdit);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 font-mono transition"
              title="Click to change verification threshold"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>THRESHOLD: <strong className="text-white">{threshold.toFixed(2)}</strong></span>
            </button>

            {showThresholdEdit && (
              <div className="absolute right-0 mt-2 w-64 p-3 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 text-xs space-y-2">
                <div className="font-semibold text-slate-200">Confidence Threshold</div>
                <p className="text-slate-400 text-[11px]">
                  Claims scoring below this similarity threshold are flagged as unsupported. Default: 0.60.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={tempThreshold}
                    onChange={(e) => setTempThreshold(e.target.value)}
                    className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={handleSaveThreshold}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium text-xs transition"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => setShowThresholdEdit(false)}
                    className="px-2 py-1 text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Knowledge Base Button */}
          <button
            onClick={onOpenKb}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 transition"
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>KB Docs: <strong className="text-white">{kbDocs.length}</strong></span>
          </button>

          {/* Schema & Exasol Architecture */}
          <button
            onClick={onOpenSchema}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 transition"
            title="Inspect Exasol SQL Schema and Views"
          >
            <Code className="w-3.5 h-3.5 text-purple-400" />
            <span>SQL Schema</span>
          </button>

          {/* Reset Demo Data */}
          <button
            onClick={onResetData}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition"
            title="Reset demo data to default initial state"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
