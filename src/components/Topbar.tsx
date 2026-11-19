import React from 'react';
import { Menu, Sparkles } from 'lucide-react';
import { NavView } from '../types';

interface TopbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onOpenCapabilities: () => void;
  onOpenMobileDrawer: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentView,
  onSelectView,
  onOpenCapabilities,
  onOpenMobileDrawer
}) => {
  const navItems: { view: NavView; label: string; featured?: boolean }[] = [
    { view: 'CHAT', label: 'Assistant' },
    { view: 'HOME', label: 'Overview' },
    { view: 'XFILL', label: 'Xfill', featured: true },
    { view: 'VISION', label: 'Vision' },
    { view: 'MEMORY', label: 'Memory' },
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

      {/* Zone 2: Centered navigation links with highlighted Xfill tab */}
      <nav aria-label="Primary workspace navigation" className="hidden md:flex items-center gap-6 text-sm font-medium">
        {navItems.map((item) => {
          const isActive = currentView === item.view;
          if (item.featured) {
            return (
              <a
                key={item.view}
                href="#xfill"
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectView(item.view);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-orange-500 border-orange-400 text-black font-semibold shadow-[0_0_20px_rgba(249,115,22,0.38)]'
                    : 'bg-orange-500/12 border-orange-500/45 text-orange-400 font-semibold hover:bg-orange-500/20 hover:border-orange-400 hover:text-orange-300 shadow-[0_0_16px_rgba(249,115,22,0.16)]'
                }`}
              >
                <Sparkles size={13} className={isActive ? 'text-black' : 'text-orange-400'} />
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

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenCapabilities}
          className="px-4 py-2 text-xs font-semibold text-black bg-orange-500 hover:bg-orange-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          Commands & Guide
        </button>
      </div>
    </header>
  );
};
