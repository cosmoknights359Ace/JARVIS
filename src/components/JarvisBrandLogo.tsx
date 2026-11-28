import React, { useId } from 'react';

export interface JarvisBrandLogoProps {
  className?: string;
}

export const JarvisBrandLogo: React.FC<JarvisBrandLogoProps> = ({ className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const cyanGlowId = `${uid}-brand-cyan`;
  const orangeGlowId = `${uid}-brand-orange`;

  return (
    <span
      data-testid="jarvis-brand-logo"
      className={`inline-flex items-center gap-2 whitespace-nowrap shrink-0 select-none ${className}`}
    >
      {/* 22x22 Miniature SVG Arc-Reactor HUD Emblem */}
      <svg
        width={22}
        height={22}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="w-[22px] h-[22px] shrink-0 overflow-visible"
      >
        <defs>
          <filter id={cyanGlowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={orangeGlowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle Dark Core Fill */}
        <circle cx="12" cy="12" r="9.5" fill="#060B12" stroke="#38BDF8" strokeOpacity="0.22" strokeWidth="0.75" />

        {/* Glowing Cyan Segmented Outer Arcs */}
        <g filter={`url(#${cyanGlowId})`} stroke="#38BDF8" strokeLinecap="round">
          <path d="M 12 2.4 A 9.6 9.6 0 0 1 21.1 9.0" strokeWidth="1.75" />
          <path d="M 20.6 16.3 A 9.6 9.6 0 0 1 6.7 19.9" strokeWidth="1.75" />
          <path d="M 3.4 16.3 A 9.6 9.6 0 0 1 8.5 3.1" strokeWidth="1.5" strokeOpacity="0.88" />
        </g>

        {/* Fine Inner Cyan Tracking Ring */}
        <circle
          cx="12"
          cy="12"
          r="6.2"
          stroke="#7DD3FC"
          strokeWidth="0.8"
          strokeDasharray="6 3.5"
          strokeOpacity="0.7"
        />

        {/* Subtle Orange Micro-Arc Accent + Glowing Orange Core Dot */}
        <g filter={`url(#${orangeGlowId})`}>
          <path
            d="M 16.8 6.4 A 7.4 7.4 0 0 1 19.1 13.6"
            stroke="#F97316"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2.7" fill="#F97316" />
          <circle cx="12" cy="12" r="1.15" fill="#FED7AA" />
        </g>
      </svg>

      {/* Orbitron Geometric Sci-Fi Wordmark */}
      <span className="font-brand font-bold text-[15px] leading-none tracking-[0.22em] text-[#F8FAFC] jarvis-brand-wordmark">
        J<span className="jarvis-brand-dot">.</span>A<span className="jarvis-brand-dot">.</span>R
        <span className="jarvis-brand-dot">.</span>V<span className="jarvis-brand-dot">.</span>I
        <span className="jarvis-brand-dot">.</span>S<span className="jarvis-brand-dot">.</span>
      </span>

      {/* Compact Monospace Version Badge */}
      <span className="font-mono text-[10px] font-medium leading-none tracking-normal px-1.5 py-0.5 rounded-full bg-slate-900/95 border border-orange-500/35 text-orange-300/90 shrink-0 -ml-1">
        v1.0
      </span>
    </span>
  );
};
