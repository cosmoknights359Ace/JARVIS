import React, { useState } from 'react';
import { Database, Plus, Trash2, Search, Download, Copy, Check } from 'lucide-react';
import { MemoryStore } from '../types';
import { sfx } from '../services/soundEffects';

interface MemoryViewProps {
  memory: MemoryStore;
  onUpdateMemory: (newMemory: MemoryStore) => void;
  onClearMemory: () => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  memory,
  onUpdateMemory,
  onClearMemory
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const entries = Object.entries(memory);
  const filtered = entries.filter(
    ([k, v]) =>
      k.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k || !v) return;

    sfx.playCommandConfirm();
    onUpdateMemory({ ...memory, [k]: v });
    setNewKey('');
    setNewValue('');
  };

  const handleDelete = (key: string) => {
    const updated = { ...memory };
    delete updated[key];
    onUpdateMemory(updated);
  };

  const copyEntry = (k: string, v: string) => {
    navigator.clipboard.writeText(`${k}=${v}`);
    setCopiedKey(k);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(memory, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis_memory.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#070709]" id="view-MEMORY">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#111115] border border-zinc-800/90 rounded-2xl p-6">
          <div>
            <h1 className="text-xl font-display font-bold text-zinc-100 flex items-center gap-2.5">
              <Database size={20} className="text-orange-500" />
              <span>Persistent Memory Store</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              {entries.length} stored facts · Injected automatically into every J.A.R.V.I.S system prompt.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={handleExportJSON}
              className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Download size={14} className="text-orange-500" />
              <span>Export JSON</span>
            </button>
            {entries.length > 0 && (
              <button
                onClick={onClearMemory}
                className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Trash2 size={14} />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {/* Add Memory Form */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-display font-semibold text-zinc-200">
            Add or Update Memory Fact
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Key (e.g. preferred_stack)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="sm:w-1/3 bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            />
            <input
              type="text"
              placeholder="Value (e.g. Python + React + TypeScript)"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="sm:flex-1 bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-black font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus size={14} />
              <span>Save Fact</span>
            </button>
          </form>
        </div>

        {/* High-Density Memory Table */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-sm font-display font-semibold text-zinc-200">
              Stored Key-Value Pairs ({filtered.length})
            </span>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Filter memory keys or values..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              {entries.length === 0
                ? 'No memories saved yet. Add a fact above or type "remember key=value" in chat.'
                : 'No entries match your search filter.'}
            </div>
          ) : (
            <div className="divide-y divide-zinc-900">
              {filtered.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-4 flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-orange-400 truncate">
                        {k}
                      </span>
                    </div>
                    <div className="sm:col-span-8 text-xs text-zinc-200 truncate">
                      {v}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => copyEntry(k, v)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
                      title="Copy key=value"
                    >
                      {copiedKey === k ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(k)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition-colors"
                      title="Delete entry"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
