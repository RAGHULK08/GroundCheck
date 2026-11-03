import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Scale, FlaskConical } from 'lucide-react';
import { Header } from './components/Header';
import { RunCheckPanel } from './components/RunCheckPanel';
import { MetricsOverview } from './components/MetricsOverview';
import { HallucinationChart } from './components/HallucinationChart';
import { AuditTrailTable } from './components/AuditTrailTable';
import { DrillDownInspector } from './components/DrillDownInspector';
import { ModelComparisonView } from './components/ModelComparisonView';
import { KnowledgeBaseModal } from './components/KnowledgeBaseModal';
import { ExasolModal } from './components/ExasolModal';
import { TestSuitePanel } from './components/TestSuitePanel';
import {
  CheckRecord,
  KnowledgeBaseDoc,
  VerificationResult,
} from './types/groundcheck';
import {
  loadKnowledgeBase,
  saveKnowledgeBase,
  loadChecks,
  saveChecks,
  appendCheck,
  getThreshold,
  setThreshold as persistThreshold,
  resetAllData,
  calculateDailyModelStats,
  INITIAL_DOCS,
} from './services/storage';
import { verifyResponse } from './services/verifier';
import { runTestCases, TestReport } from './services/testRunner';
import { VERIFIER_TEST_CASES } from './services/verifier.test-cases';

export const App: React.FC = () => {
  const [kbDocs, setKbDocs] = useState<KnowledgeBaseDoc[]>(() => loadKnowledgeBase());
  const [checks, setChecks] = useState<CheckRecord[]>(() => loadChecks());
  const [threshold, setThresholdState] = useState<number>(() => getThreshold());
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(() => {
    const loaded = loadChecks();
    // Default to first flagged check or first check
    const firstFlagged = loaded.find((c) => c.verdict !== 'GROUNDED');
    return firstFlagged ? firstFlagged.checkId : loaded[0]?.checkId || null;
  });

  const [isVerifying, setIsVerifying] = useState(false);
  const [latestResult, setLatestResult] = useState<VerificationResult | null>(null);
  const [latestResponseText, setLatestResponseText] = useState<string>('');

  const [isKbModalOpen, setIsKbModalOpen] = useState(false);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<'single' | 'benchmark' | 'tests'>('single');
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testProgress, setTestProgress] = useState<{ done: number; total: number } | null>(null);

  const handleRunTests = async (): Promise<void> => {
    setIsRunningTests(true);
    setTestProgress({ done: 0, total: VERIFIER_TEST_CASES.length });
    try {
      const report = await runTestCases({
        onProgress: (done, total) => setTestProgress({ done, total }),
      });
      setTestReport(report);
    } finally {
      setIsRunningTests(false);
      setTestProgress(null);
    }
  };

  // Compute daily model stats (view emulation)
  const dailyStats = useMemo(() => calculateDailyModelStats(checks), [checks]);

  const handleBatchLogChecks = (newChecks: CheckRecord[]) => {
    const updated = [...newChecks, ...checks];
    setChecks(updated);
    saveChecks(updated);
    if (newChecks.length > 0) {
      setSelectedCheckId(newChecks[0].checkId);
    }
  };

  const handleUpdateThreshold = (newVal: number) => {
    setThresholdState(newVal);
    persistThreshold(newVal);
  };

  const handleRunCheck = async (
    prompt: string,
    response: string,
    modelName: string,
    enableWebSearch: boolean = true
  ) => {
    setIsVerifying(true);
    setLatestResponseText(response);

    // Give visual feedback for verification processing
    await new Promise((resolve) => setTimeout(resolve, 350));

    try {
      const { result, usedDocIds } = await verifyResponse(
        prompt,
        response,
        modelName,
        kbDocs,
        threshold,
        enableWebSearch
      );

      const newRecord: CheckRecord = {
        checkId: result.checkId,
        prompt,
        response,
        modelName,
        verdict: result.verdict,
        confidenceScore: result.confidenceScore,
        flaggedSpans: result.flaggedSpans,
        sourceDocIds: usedDocIds,
        latencyMs: result.latencyMs,
        createdAt: new Date().toISOString(),
        citations: result.citations,
        usedWebSearch: result.usedWebSearch,
        claimsAnalysis: result.claimsAnalysis,
      };

      const updated = appendCheck(newRecord);
      setChecks(updated);
      setLatestResult(result);
      setSelectedCheckId(result.checkId);
      return result;
    } catch (err) {
      console.error('Verification failed', err);
      return null;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleAddKbDoc = (title: string, content: string, source: string) => {
    const newDoc: KnowledgeBaseDoc = {
      docId: 'doc-' + Math.random().toString(36).substring(2, 9),
      title,
      content,
      source,
      embedding: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [...kbDocs, newDoc];
    setKbDocs(updated);
    saveKnowledgeBase(updated);
  };

  const handleDeleteKbDoc = (docId: string) => {
    const updated = kbDocs.filter((d) => d.docId !== docId);
    setKbDocs(updated);
    saveKnowledgeBase(updated);
  };

  const handleRestoreKbDefaults = () => {
    setKbDocs(INITIAL_DOCS);
    saveKnowledgeBase(INITIAL_DOCS);
  };

  const handleResetData = () => {
    if (confirm('Reset all audit logs and knowledge base documents back to demo defaults?')) {
      const reset = resetAllData();
      setKbDocs(reset.kb);
      setChecks(reset.checks);
      setThresholdState(getThreshold());
      setSelectedCheckId(reset.checks[0]?.checkId || null);
      setLatestResult(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <Header
        threshold={threshold}
        onUpdateThreshold={handleUpdateThreshold}
        kbDocs={kbDocs}
        onOpenKb={() => setIsKbModalOpen(true)}
        onOpenSchema={() => setIsSchemaModalOpen(true)}
        onResetData={handleResetData}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 space-y-6 flex-1">
        {/* View Mode Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveView('single')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeView === 'single'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Single Prompt Verifier</span>
            </button>

            <button
              onClick={() => setActiveView('benchmark')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeView === 'benchmark'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Side-by-Side Model Comparison</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/30">
                Benchmark
              </span>
            </button>

            <button
              onClick={() => setActiveView('tests')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeView === 'tests'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>Test Suite</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 px-2 hidden sm:block">
            {activeView === 'single'
              ? 'Verifying individual prompts against the local knowledge base'
              : activeView === 'benchmark'
              ? 'Multi-LLM comparative benchmarking'
              : 'Labelled cases against the default refund & shipping policies'}
          </div>
        </div>

        {/* Panel: Active Evaluation Mode */}
        {activeView === 'single' ? (
          <RunCheckPanel
            onRunCheck={handleRunCheck}
            isVerifying={isVerifying}
            latestResult={latestResult}
            latestResponseText={latestResponseText}
          />
        ) : activeView === 'tests' ? (
          <TestSuitePanel
            report={testReport}
            isRunning={isRunningTests}
            progress={testProgress}
            totalCases={VERIFIER_TEST_CASES.length}
            onRun={handleRunTests}
          />
        ) : (
          <ModelComparisonView
            kbDocs={kbDocs}
            threshold={threshold}
            dailyStats={dailyStats}
            onBatchLogChecks={handleBatchLogChecks}
          />
        )}

        {/* Divider */}
        <hr className="border-slate-800" />

        {/* Section 2: Metrics Overview */}
        <MetricsOverview checks={checks} />

        {/* Section 3: Hallucination Rate Over Time (by Model) */}
        <HallucinationChart stats={dailyStats} />

        {/* Section 4: Audit Trail Table */}
        <AuditTrailTable
          checks={checks}
          selectedCheckId={selectedCheckId}
          onSelectCheck={(id) => setSelectedCheckId(id)}
        />

        {/* Section 5: Drill into a flagged response */}
        <DrillDownInspector
          checks={checks}
          selectedCheckId={selectedCheckId}
          onSelectCheck={(id) => setSelectedCheckId(id)}
          kbDocs={kbDocs}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-4 py-6 text-center text-xs text-slate-500 space-y-1">
        <div>
          <strong>GroundCheck / AuditLens</strong> — LLM output verification &amp; audit-trail layer. Data is stored in browser local storage; an Exasol schema is included for deployment.
        </div>
        <div className="font-mono text-[11px] text-slate-600">
          Tables: <span className="text-slate-400">KNOWLEDGE_BASE</span> • <span className="text-slate-400">CHECKS</span> • View: <span className="text-slate-400">DAILY_MODEL_STATS</span>
        </div>
      </footer>

      {/* Modals */}
      <KnowledgeBaseModal
        isOpen={isKbModalOpen}
        onClose={() => setIsKbModalOpen(false)}
        docs={kbDocs}
        onAddDoc={handleAddKbDoc}
        onDeleteDoc={handleDeleteKbDoc}
        onRestoreDefaults={handleRestoreKbDefaults}
      />

      <ExasolModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        checksCount={checks.length}
        kbCount={kbDocs.length}
      />
    </div>
  );
};

export default App;
