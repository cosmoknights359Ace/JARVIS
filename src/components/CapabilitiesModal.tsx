import React, { useState } from 'react';
import {
  X,
  Play,
  Search,
  Terminal,
  Database,
  Cpu,
  Compass,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { CAPABILITY_CATEGORIES } from '../services/jarvisBrain';
import { getShort } from '../services/attribution';
import { NavView } from '../types';

interface CapabilitiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: (command: string) => void;
  onSelectView?: (view: NavView) => void;
}

interface WorkspaceToolEntry {
  view: NavView;
  label: string;
  tag: string;
  description: string;
}

const WORKSPACE_TOOLS: WorkspaceToolEntry[] = [
  {
    view: 'xconvert',
    label: 'Xconvert (Local File Converter)',
    tag: 'Images · PDF · Docs · Data · Media · Archives',
    description: 'Convert files locally disk-to-disk with zero upload or size limits.'
  },
  {
    view: 'XFILL',
    label: 'Xfill (Doc Auto-Fill)',
    tag: 'DOCX · XLSX · PPTX',
    description: 'Upload office documents to auto-fill blanks, {{tags}}, and Q&A.'
  },
  {
    view: 'SLIDES',
    label: 'Xslide (PPT Studio)',
    tag: '16:9 PowerPoint Decks',
    description: 'Generate themed presentations with tables, visuals, and speaker notes.'
  }
];

export const CapabilitiesModal: React.FC<CapabilitiesModalProps> = ({
  isOpen,
  onClose,
  onRunCommand,
  onSelectView
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  if (!isOpen) return null;

  const q = searchQuery.trim().toLowerCase();

  const filteredTools =
    activeCategory === 'all' || activeCategory === 'tools'
      ? WORKSPACE_TOOLS.filter(
          (tool) =>
            !q ||
            tool.label.toLowerCase().includes(q) ||
            tool.tag.toLowerCase().includes(q) ||
            tool.description.toLowerCase().includes(q)
        )
      : [];

  const filteredCategories = CAPABILITY_CATEGORIES.map((cat) => {
    if (activeCategory !== 'all' && cat.id !== activeCategory) {
      return { ...cat, items: [] };
    }
    const items = cat.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.command.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
    return { ...cat, items };
  }).filter((cat) => cat.items.length > 0);

  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'memory':
        return <Database size={16} className="text-orange-500" />;
      case 'utilities':
        return <Terminal size={16} className="text-orange-500" />;
      case 'launchers':
        return <Compass size={16} className="text-orange-500" />;
      default:
        return <Cpu size={16} className="text-orange-500" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0F0F13] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80">
          <div>
            <h2 className="text-lg font-display font-semibold text-zinc-100">
              J.A.R.V.I.S Command & Capability Guide
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Launch workspace tools or click any command below, or type{' '}
              <code className="font-mono text-orange-400">/</code> in the prompt bar.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-6 py-3 bg-[#070709] border-b border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-zinc-900 rounded-lg overflow-x-auto">
            {[
              { id: 'all', label: 'All' },
              { id: 'tools', label: 'Tools' },
              { id: 'memory', label: 'Memory' },
              { id: 'utilities', label: 'Utilities' },
              { id: 'launchers', label: 'Web' },
              { id: 'coding', label: 'Auto AI' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeCategory === tab.id
                    ? 'bg-orange-500 text-black font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-56 shrink-0">
            <Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tools & commands..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {filteredTools.length === 0 && filteredCategories.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              No tools or commands match "{searchQuery}".
            </div>
          ) : (
            <>
              {filteredTools.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2">
                    <Layers size={16} className="text-orange-500" />
                    <h3 className="text-sm font-display font-semibold text-zinc-200">
                      Workspace Tools
                    </h3>
                    <span className="text-xs text-zinc-500 hidden sm:inline">
                      · Built-in local document, slide, and file studios.
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-900 border border-zinc-800/90 rounded-xl bg-[#070709]">
                    {filteredTools.map((tool) => (
                      <div
                        key={tool.view}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-200">
                              {tool.label}
                            </span>
                            <span className="text-zinc-700">·</span>
                            <code className="text-xs font-mono text-orange-400 truncate">
                              {tool.tag}
                            </code>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">{tool.description}</p>
                        </div>

                        {onSelectView && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectView(tool.view);
                              onClose();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-orange-500 hover:text-black border border-zinc-800 hover:border-orange-500 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
                          >
                            <ArrowUpRight size={13} />
                            Open Tool
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredCategories.map((cat) => (
                <div key={cat.id} className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2">
                    {getCategoryIcon(cat.id)}
                    <h3 className="text-sm font-display font-semibold text-zinc-200">
                      {cat.title}
                    </h3>
                    <span className="text-xs text-zinc-500 hidden sm:inline">
                      · {cat.subtitle}
                    </span>
                  </div>

                  <div className="divide-y divide-zinc-900 border border-zinc-800/90 rounded-xl bg-[#070709]">
                    {cat.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-200">
                              {item.label}
                            </span>
                            <span className="text-zinc-700">·</span>
                            <code className="text-xs font-mono text-orange-400 truncate">
                              {item.example}
                            </code>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">
                            {item.description}
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            onRunCommand(item.command);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-orange-500 hover:text-black border border-zinc-800 hover:border-orange-500 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
                        >
                          <Play size={12} />
                          Run Now
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#070709] border-t border-zinc-900 flex items-center justify-between text-xs text-zinc-500">
          <span>
            Hotkeys: <code className="font-mono text-zinc-300">Ctrl+K</code> Guide ·{' '}
            <code className="font-mono text-zinc-300">Ctrl+L</code> Clear ·{' '}
            <code className="font-mono text-zinc-300">Ctrl+E</code> Export ·{' '}
            <code className="font-mono text-zinc-300">Ctrl+M</code> Mute
          </span>
          <span className="font-mono text-[11px] text-zinc-600">{getShort()}</span>
        </div>
      </div>
    </div>
  );
};

