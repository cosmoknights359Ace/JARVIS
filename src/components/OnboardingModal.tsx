import React, { useEffect } from 'react';
import {
  X,
  MessageSquare,
  FileSpreadsheet,
  Presentation,
  ArrowLeftRight,
  Database,
  Cpu,
  Sparkles,
  ArrowUpRight
} from 'lucide-react';
import { NavView } from '../types';

interface OnboardingModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onSelectView?: (view: NavView) => void;
}

interface QuickStartCard {
  id: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  targetView?: NavView;
}

const QUICK_START_CARDS: QuickStartCard[] = [
  {
    id: 'chat',
    icon: <MessageSquare size={16} className="text-orange-400" />,
    title: 'Local AI Chat',
    description: 'Private, offline chat with automatic model routing and streaming.',
    targetView: 'CHAT'
  },
  {
    id: 'xfill',
    icon: <FileSpreadsheet size={16} className="text-orange-400" />,
    title: 'Xfill (Doc Auto-Fill)',
    description: (
      <>
        Upload DOCX, XLSX, or PPTX files to fill blanks,{' '}
        <code className="font-mono text-orange-400/90 text-[11px]">{'{{tags}}'}</code>, and Q&amp;A.
      </>
    ),
    targetView: 'XFILL'
  },
  {
    id: 'xslide',
    icon: <Presentation size={16} className="text-orange-400" />,
    title: 'Xslide (PPT Studio)',
    description: 'Generate themed 16:9 PowerPoint decks with speaker notes in seconds.',
    targetView: 'SLIDES'
  },
  {
    id: 'xconvert',
    icon: <ArrowLeftRight size={16} className="text-orange-400" />,
    title: 'Xconvert (File Converter)',
    description: 'Convert images, PDFs, docs, media, and archives locally with zero size limits.',
    targetView: 'xconvert'
  },
  {
    id: 'memory',
    icon: <Database size={16} className="text-orange-400" />,
    title: (
      <>
        Memory Bank (<code className="font-mono text-orange-400 text-[11px]">/remember</code>)
      </>
    ),
    description: 'Save personal facts once and recall them across any new chat.',
    targetView: 'CHAT'
  },
  {
    id: 'hardware',
    icon: <Cpu size={16} className="text-orange-400" />,
    title: 'Hardware-Aware Engine',
    description: 'Automatically scales context limits and models to match your GPU VRAM.',
    targetView: 'SETTINGS'
  }
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onDismiss,
  onSelectView
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  const handleCardClick = (targetView?: NavView) => {
    if (targetView && onSelectView) {
      onSelectView(targetView);
      onDismiss();
    }
  };

  return (
    <div
      data-testid="onboarding-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-modal-title"
        className="w-full max-w-2xl bg-[#0F0F13] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500/12 border border-orange-500/35 flex items-center justify-center shrink-0">
              <Sparkles size={17} className="text-orange-400" />
            </div>
            <div>
              <h2
                id="onboarding-modal-title"
                className="text-lg font-display font-semibold text-zinc-100 tracking-tight"
              >
                Welcome to J.A.R.V.I.S
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Quick-start guide to your local AI workspace.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close Quick Guide"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          >
            <X size={17} />
          </button>
        </div>

        {/* 2x3 Feature Grid */}
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {QUICK_START_CARDS.map((card) => {
              const clickable = Boolean(card.targetView && onSelectView);
              return (
                <button
                  type="button"
                  key={card.id}
                  data-testid={`onboarding-card-${card.id}`}
                  onClick={() => handleCardClick(card.targetView)}
                  disabled={!clickable}
                  className={`group text-left p-4 rounded-xl bg-[#070709] border border-zinc-800/90 transition-colors flex items-start gap-3 ${
                    clickable
                      ? 'hover:border-orange-500/45 hover:bg-[#0B0B0F] cursor-pointer'
                      : 'cursor-default'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/25 flex items-center justify-center shrink-0 mt-0.5">
                    {card.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-display font-semibold text-zinc-100 group-hover:text-orange-300 transition-colors">
                        {card.title}
                      </h3>
                      {clickable && (
                        <ArrowUpRight
                          size={13}
                          className="text-zinc-600 group-hover:text-orange-400 transition-colors shrink-0"
                        />
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-snug">
                      {card.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#070709] border-t border-zinc-900 flex items-center justify-between gap-4">
          <span className="text-xs text-zinc-500">
            Reopen anytime with the <span className="font-mono text-zinc-300">?</span> icon in the header.
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="px-5 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};

