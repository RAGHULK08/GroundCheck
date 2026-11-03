import React, { useState } from 'react';
import { LineChart as ChartIcon, Table, Info } from 'lucide-react';
import { DailyModelStat } from '../types/groundcheck';

interface HallucinationChartProps {
  stats: DailyModelStat[];
}

// Consistent colors for models
const MODEL_COLORS: Record<string, { stroke: string; fill: string; text: string }> = {
  'gpt-4o': { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.2)', text: 'text-cyan-400' },
  'claude-3-5-sonnet': { stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.2)', text: 'text-purple-400' },
  'gemini-1.5-pro': { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.2)', text: 'text-blue-400' },
  'llama-3-70b': { stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.2)', text: 'text-orange-400' },
  'mistral-large': { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.2)', text: 'text-pink-400' },
};

const DEFAULT_COLOR = { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.2)', text: 'text-emerald-400' };

export const HallucinationChart: React.FC<HallucinationChartProps> = ({ stats }) => {
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [hoveredPoint, setHoveredPoint] = useState<{
    date: string;
    model: string;
    rate: number;
    total: number;
    x: number;
    y: number;
  } | null>(null);

  if (stats.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500">
        No stats logged yet. Run checks to generate daily model metrics.
      </div>
    );
  }

  // Extract unique sorted dates & models
  const uniqueDates = Array.from(new Set(stats.map((s) => s.checkDate))).sort();
  const uniqueModels = Array.from(new Set(stats.map((s) => s.modelName)));

  // SVG Chart dimensions
  const width = 800;
  const height = 240;
  const padding = { top: 20, right: 30, bottom: 40, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // X coordinate mapping
  const getX = (dateIndex: number) => {
    if (uniqueDates.length <= 1) return padding.left + chartW / 2;
    return padding.left + (dateIndex / (uniqueDates.length - 1)) * chartW;
  };

  // Y coordinate mapping (0.0 to 1.0)
  const getY = (val: number) => {
    return padding.top + (1 - Math.max(0, Math.min(1, val))) * chartH;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      {/* Title & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base lg:text-lg font-bold text-white flex items-center gap-2">
            <span>Hallucination rate over time (by model)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Aggregated in the browser (same logic as the Exasol view <code className="text-cyan-400 font-mono">DAILY_MODEL_STATS</code>)
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('chart')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
              activeTab === 'chart'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ChartIcon className="w-3.5 h-3.5" />
            <span>Line Chart</span>
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
              activeTab === 'table'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>SQL View Table</span>
          </button>
        </div>
      </div>

      {/* Model Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-slate-500 font-mono text-[11px] uppercase">Models:</span>
        {uniqueModels.map((model) => {
          const style = MODEL_COLORS[model] || DEFAULT_COLOR;
          return (
            <div key={model} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: style.stroke }}
              />
              <span className="font-mono text-slate-300">{model}</span>
            </div>
          );
        })}
      </div>

      {/* View Content */}
      {activeTab === 'chart' ? (
        <div className="relative w-full overflow-x-auto">
          <div className="min-w-[600px]">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto overflow-visible"
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {/* Horizontal Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((rate) => {
                const y = getY(rate);
                return (
                  <g key={rate}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray={rate === 0 ? '0' : '4 4'}
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      fill="#64748b"
                      fontSize="10"
                      textAnchor="end"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {Math.round(rate * 100)}%
                    </text>
                  </g>
                );
              })}

              {/* Vertical Date tick lines */}
              {uniqueDates.map((date, idx) => {
                const x = getX(idx);
                return (
                  <g key={date}>
                    <line
                      x1={x}
                      y1={padding.top}
                      x2={x}
                      y2={height - padding.bottom}
                      stroke="#1e293b"
                    />
                    <text
                      x={x}
                      y={height - padding.bottom + 18}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor="middle"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {date.substring(5)}
                    </text>
                  </g>
                );
              })}

              {/* Series Lines per model */}
              {uniqueModels.map((model) => {
                const color = MODEL_COLORS[model] || DEFAULT_COLOR;
                const points: { x: number; y: number; rate: number; total: number; date: string }[] = [];

                uniqueDates.forEach((date, dateIdx) => {
                  const stat = stats.find((s) => s.checkDate === date && s.modelName === model);
                  if (stat) {
                    points.push({
                      x: getX(dateIdx),
                      y: getY(stat.hallucinationRate),
                      rate: stat.hallucinationRate,
                      total: stat.totalChecks,
                      date,
                    });
                  }
                });

                if (points.length === 0) return null;

                const pathData = points
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                  .join(' ');

                return (
                  <g key={model}>
                    {/* Line */}
                    <path
                      d={pathData}
                      fill="none"
                      stroke={color.stroke}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Points */}
                    {points.map((p, pIdx) => (
                      <circle
                        key={pIdx}
                        cx={p.x}
                        cy={p.y}
                        r="4.5"
                        fill="#020617"
                        stroke={color.stroke}
                        strokeWidth="2"
                        className="cursor-pointer transition-transform hover:scale-150"
                        onMouseEnter={() =>
                          setHoveredPoint({
                            date: p.date,
                            model,
                            rate: p.rate,
                            total: p.total,
                            x: p.x,
                            y: p.y,
                          })
                        }
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {/* Hover Tooltip */}
            {hoveredPoint && (
              <div
                className="absolute pointer-events-none bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg shadow-xl text-xs space-y-0.5 z-20 font-mono"
                style={{
                  left: `${(hoveredPoint.x / width) * 100}%`,
                  top: `${hoveredPoint.y - 60}px`,
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="text-white font-bold">{hoveredPoint.model}</div>
                <div className="text-slate-400 text-[11px]">{hoveredPoint.date}</div>
                <div className="text-rose-400 font-semibold">
                  Hallucination Rate: {(hoveredPoint.rate * 100).toFixed(1)}%
                </div>
                <div className="text-slate-400 text-[10px]">
                  Total checks: {hoveredPoint.total}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SQL View Table: exact replica of st.dataframe(stats_df) */
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3">CHECK_DATE</th>
                <th className="py-2.5 px-3">MODEL_NAME</th>
                <th className="py-2.5 px-3 text-right">TOTAL_CHECKS</th>
                <th className="py-2.5 px-3 text-right text-rose-400">HALLUCINATED</th>
                <th className="py-2.5 px-3 text-right text-amber-400">PARTIAL</th>
                <th className="py-2.5 px-3 text-right text-amber-300">UNVERIFIABLE</th>
                <th className="py-2.5 px-3 text-right text-emerald-400">GROUNDED</th>
                <th className="py-2.5 px-3 text-right">AVG_CONFIDENCE</th>
                <th className="py-2.5 px-3 text-right text-cyan-400">HALLUCINATION_RATE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
              {stats.map((s, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition">
                  <td className="py-2 px-3 text-slate-300">{s.checkDate}</td>
                  <td className="py-2 px-3 font-semibold text-white">{s.modelName}</td>
                  <td className="py-2 px-3 text-right text-slate-300">{s.totalChecks}</td>
                  <td className="py-2 px-3 text-right text-rose-400 font-semibold">{s.hallucinatedCount}</td>
                  <td className="py-2 px-3 text-right text-amber-400 font-semibold">{s.partialCount}</td>
                  <td className="py-2 px-3 text-right text-amber-300 font-semibold">{s.unverifiableCount ?? 0}</td>
                  <td className="py-2 px-3 text-right text-emerald-400 font-semibold">{s.groundedCount}</td>
                  <td className="py-2 px-3 text-right text-slate-300">{s.avgConfidence.toFixed(4)}</td>
                  <td className="py-2 px-3 text-right text-cyan-300 font-bold">
                    {(s.hallucinationRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
