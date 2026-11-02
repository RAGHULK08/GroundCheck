import React from 'react';
import { X, Database, Terminal, Shield, CheckCircle, Copy } from 'lucide-react';

interface ExasolModalProps {
  isOpen: boolean;
  onClose: () => void;
  checksCount: number;
  kbCount: number;
}

export const ExasolModal: React.FC<ExasolModalProps> = ({
  isOpen,
  onClose,
  checksCount,
  kbCount,
}) => {
  if (!isOpen) return null;

  const sqlSchema = `-- GroundCheck / AuditLens — Exasol Personal schema
CREATE SCHEMA IF NOT EXISTS GROUNDCHECK;
OPEN SCHEMA GROUNDCHECK;

-- 1. Knowledge base: the "ground truth" source documents that LLM responses are checked against.
CREATE TABLE IF NOT EXISTS KNOWLEDGE_BASE (
    DOC_ID          VARCHAR(64)     NOT NULL,
    TITLE           VARCHAR(500),
    CONTENT         VARCHAR(2000000),
    "SOURCE"        VARCHAR(500),
    EMBEDDING       VARCHAR(2000000),
    CREATED_AT      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (DOC_ID)
);

-- 2. Audit log: every prompt/response pair that gets verified, with its verdict.
CREATE TABLE IF NOT EXISTS CHECKS (
    CHECK_ID            VARCHAR(64)     NOT NULL,
    PROMPT              VARCHAR(2000000) NOT NULL,
    RESPONSE            VARCHAR(2000000) NOT NULL,
    MODEL_NAME          VARCHAR(200),
    VERDICT             VARCHAR(20),     -- 'GROUNDED' | 'PARTIAL' | 'HALLUCINATED'
    CONFIDENCE_SCORE    DECIMAL(5,4),    -- 0.0000 - 1.0000 groundedness score
    FLAGGED_SPANS       VARCHAR(2000000),
    SOURCE_DOC_IDS      VARCHAR(2000),
    LATENCY_MS          DECIMAL(10,2),
    CREATED_AT          TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (CHECK_ID)
);

-- 3. Convenience view for the dashboard: daily hallucination rate per model.
CREATE OR REPLACE VIEW DAILY_MODEL_STATS AS
SELECT
    CAST(CREATED_AT AS DATE)                                   AS CHECK_DATE,
    MODEL_NAME,
    COUNT(*)                                                   AS TOTAL_CHECKS,
    SUM(CASE WHEN VERDICT = 'HALLUCINATED' THEN 1 ELSE 0 END)  AS HALLUCINATED_COUNT,
    SUM(CASE WHEN VERDICT = 'PARTIAL' THEN 1 ELSE 0 END)       AS PARTIAL_COUNT,
    SUM(CASE WHEN VERDICT = 'GROUNDED' THEN 1 ELSE 0 END)      AS GROUNDED_COUNT,
    AVG(CONFIDENCE_SCORE)                                      AS AVG_CONFIDENCE
FROM CHECKS
GROUP BY CAST(CREATED_AT AS DATE), MODEL_NAME;`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-purple-400" />
            <h3 className="font-bold text-white text-base">
              Exasol Personal System of Record
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Explanation */}
          <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-500/30 text-xs text-purple-200 space-y-2">
            <div className="font-semibold text-sm text-purple-100 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-purple-400" />
              How Exasol Personal Powers GroundCheck / AuditLens
            </div>
            <p className="leading-relaxed">
              Exasol isn&apos;t a bolt-on data store here — it&apos;s the system of record the whole project depends on:
            </p>
            <ul className="list-disc list-inside space-y-1 text-purple-300/90 pl-1">
              <li>
                <strong className="text-white">KNOWLEDGE_BASE (table):</strong> Source-of-truth documents and embeddings ({kbCount} rows loaded).
              </li>
              <li>
                <strong className="text-white">CHECKS (table):</strong> Append-only audit log: every prompt, response, verdict, confidence score, and flagged span ({checksCount} rows recorded).
              </li>
              <li>
                <strong className="text-white">DAILY_MODEL_STATS (view):</strong> Native SQL rollup of hallucination rate per model, per day — no external BI tool needed.
              </li>
            </ul>
          </div>

          {/* SQL Schema viewer */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-cyan-400" />
                sql/schema.sql (Exasol DDL)
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(sqlSchema)}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-mono"
              >
                <Copy className="w-3 h-3" />
                <span>Copy SQL</span>
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-72 leading-relaxed">
              {sqlSchema}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
