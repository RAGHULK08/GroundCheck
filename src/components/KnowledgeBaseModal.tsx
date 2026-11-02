import React, { useState } from 'react';
import { X, BookOpen, Plus, Trash2, CheckCircle, FileText, Upload } from 'lucide-react';
import { KnowledgeBaseDoc } from '../types/groundcheck';

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  docs: KnowledgeBaseDoc[];
  onAddDoc: (title: string, content: string, source: string) => void;
  onDeleteDoc: (docId: string) => void;
  onRestoreDefaults: () => void;
}

export const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = ({
  isOpen,
  onClose,
  docs,
  onAddDoc,
  onDeleteDoc,
  onRestoreDefaults,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');

  if (!isOpen) return null;

  const handleSubmitNewDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    onAddDoc(
      title.trim(),
      content.trim(),
      source.trim() || `sample_docs/${title.toLowerCase().replace(/\s+/g, '_')}.txt`
    );

    setTitle('');
    setContent('');
    setSource('');
    setShowAddForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-blue-400" />
            <h3 className="font-bold text-white text-base">
              Exasol KNOWLEDGE_BASE Table ({docs.length} Documents)
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Source-of-truth documents stored in Exasol against which LLM output claims are compared and verified.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Document</span>
              </button>
              <button
                onClick={onRestoreDefaults}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition"
              >
                Reset Default KB
              </button>
            </div>
          </div>

          {/* New Document Form */}
          {showAddForm && (
            <form onSubmit={handleSubmitNewDoc} className="p-4 bg-slate-950 border border-cyan-500/30 rounded-xl space-y-3">
              <div className="font-semibold text-xs text-cyan-300 uppercase tracking-wider">
                Ingest New Document into KNOWLEDGE_BASE
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Terms of Service, Warranty Policy"
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Source Path</label>
                  <input
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="sample_docs/warranty_policy.txt"
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Content (Ground Truth)</label>
                <textarea
                  required
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste policy or documentation content here..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1 text-slate-400 hover:text-white text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium"
                >
                  Save to Knowledge Base
                </button>
              </div>
            </form>
          )}

          {/* Documents List */}
          <div className="space-y-3">
            {docs.map((doc) => (
              <div
                key={doc.docId}
                className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 relative group hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-white text-sm">{doc.title}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-slate-500">{doc.docId}</span>
                    {docs.length > 1 && (
                      <button
                        onClick={() => onDeleteDoc(doc.docId)}
                        className="text-slate-500 hover:text-rose-400 transition"
                        title="Delete document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed font-sans bg-slate-900/60 p-3 rounded-lg border border-slate-800/60">
                  {doc.content}
                </p>

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
                  <div>Source: <span className="text-slate-400">{doc.source}</span></div>
                  <div>Created: <span className="text-slate-400">{doc.createdAt.substring(0, 10)}</span></div>
                </div>
              </div>
            ))}
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
