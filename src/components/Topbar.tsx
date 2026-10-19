import React from 'react';
import { NavView } from '../types';

interface TopbarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  onOpenCapabilities: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentView,
  onSelectView,
  onOpenCapabilities
}) => {
  const navItems: { view: NavView; label: string }[] = [
    { view: 'CHAT', label: 'Assistant' },
    { view: 'HOME', label: 'Overview' },
    { view: 'VISION', label: 'Vision' },
    { view: 'MEMORY', label: 'Memory' },
    { view: 'SETTINGS', label: 'Settings' }
  ];

  return (
    <header className="h-14 shrink-0 flex items-center justify-between gap-8 px-6 bg-[#070709] border-b border-zinc-900">
      {/* Zone 1: Single text element wordmark */}
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

      {/* Zone 2: 5 clean single-line text navigation links */}
      <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
        {navItems.map((item) => {
          const isActive = currentView === item.view;
          return (
            <a
              key={item.view}
              href={`#${item.view.toLowerCase()}`}
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
          onClick={onOpenCapabilities}
          className="px-4 py-2 text-xs font-semibold text-black bg-orange-500 hover:bg-orange-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          Commands & Guide
        </button>
      </div>
    </header>
  );
};
