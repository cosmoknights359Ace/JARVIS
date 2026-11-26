import React from 'react';
import { Menu, Sparkles, Presentation, ArrowLeftRight, HelpCircle } from 'lucide-react';
import { NavView } from '../types';

interface TopbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onOpenCapabilities: () => void;
  onOpenOnboarding: () => void;
  onOpenMobileDrawer: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentView,
  onSelectView,
  onOpenCapabilities,
  onOpenOnboarding,
  onOpenMobileDrawer
}) => {
  const navItems: { view: NavView; label: string; featured?: boolean }[] = [
    { view: 'CHAT', label: 'Assistant' },
    { view: 'XFILL', label: 'Xfill', featured: true },
    { view: 'SLIDES', label: 'Xslide', featured: true },
    { view: 'xconvert', label: 'Xconvert', featured: true },
    { view: 'SETTINGS', label: 'Settings' }
  ];

  return (
    <header className="h-14 shrink-0 flex items-center justify-between gap-6 px-4 sm:px-6 bg-[#070709] border-b border-zinc-900">
      {/* Zone 1: Mobile menu trigger (< lg) + single-line wordmark */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-label="Open navigation and chat history"
          className="lg:hidden min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
        >
          <Menu size={19} />
        </button>

        <a
          href="#assistant"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('CHAT');
          }}
          className="text-lg font-display font-bold tracking-widest text-orange-500 whitespace-nowrap shrink-0"
        >
          J.A.R.V.I.S
        </a>
      </div>

      {/* Zone 2: Centered navigation links */}
      <nav aria-label="Primary workspace navigation" className="hidden md:flex items-center gap-5 lg:gap-7 text-sm font-medium">
        {navItems.map((item) => {
          const isActive = currentView === item.view;
          if (item.featured) {
            return (
              <a
                key={item.view}
                href={`#${item.label.toLowerCase()}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectView(item.view);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-cyan-400 border-cyan-300 text-black font-semibold shadow-[0_0_22px_rgba(34,211,238,0.6)]'
                    : 'bg-cyan-400/10 border-cyan-400/60 text-cyan-300 font-semibold hover:bg-cyan-400/20 hover:border-cyan-300 hover:text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.28)]'
                }`}
              >
                {item.view === 'SLIDES' ? (
                  <Presentation size={13} className={isActive ? 'text-black' : 'text-cyan-300'} />
                ) : item.view === 'xconvert' ? (
                  <ArrowLeftRight size={13} className={isActive ? 'text-black' : 'text-cyan-300'} />
                ) : (
                  <Sparkles size={13} className={isActive ? 'text-black' : 'text-cyan-300'} />
                )}
                <span>{item.label}</span>
              </a>
            );
          }

          return (
            <a
              key={item.view}
              href={`#${item.view.toLowerCase()}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                onSelectView(item.view);
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                isActive
                  ? 'text-orange-500 border-orange-500 font-semibold'
                  : 'text-zinc-400 border-transparent hover:text-zinc-100 hover:border-zinc-800'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* Zone 3: Quick Guide (?) + Secondary guide action */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenOnboarding}
          title="Quick Guide"
          aria-label="Quick Guide"
          className="p-2 rounded-lg text-zinc-400 hover:text-orange-400 bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800 hover:border-orange-500/40 transition-colors shrink-0"
        >
          <HelpCircle size={15} />
        </button>

        <button
          type="button"
          onClick={onOpenCapabilities}
          title="Open Commands & Guide (Ctrl+K)"
          className="px-3.5 py-1.5 text-xs font-semibold text-orange-400 bg-orange-500/12 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
        >
          <span>Commands & Guide</span>
          <kbd className="hidden sm:inline font-mono text-[10px] text-orange-300/75 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
            Ctrl+K
          </kbd>
        </button>
      </div>
    </header>
  );
};
