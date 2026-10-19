import React from 'react';

interface ArcReactorProps {
  size?: number;
  isActive?: boolean;
  pulsing?: boolean;
  ambient?: boolean;
}

export const ArcReactor: React.FC<ArcReactorProps> = ({
  size = 150,
  isActive = true,
  pulsing = true,
  ambient = false
}) => {
  return (
    <div
      className={`relative flex items-center justify-center select-none pointer-events-none ${
        ambient ? 'opacity-30' : ''
      }`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 220 220"
        className="w-full h-full overflow-visible"
        style={{
          filter: isActive
            ? 'drop-shadow(0 0 18px rgba(249, 115, 22, 0.38))'
            : 'none'
        }}
      >
        <defs>
          <linearGradient id="orangeStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF6B00" />
            <stop offset="50%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#FB923C" />
          </linearGradient>

          <radialGradient id="orangeCoreGlow" cx="50%" cy="54%" r="48%">
            <stop offset="0%" stopColor="#FF6B00" stopOpacity="0.42" />
            <stop offset="55%" stopColor="#F97316" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#070709" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft Ambient Core Radial Glow */}
        <circle
          cx="110"
          cy="118"
          r="78"
          fill="url(#orangeCoreGlow)"
          className={pulsing ? 'animate-triangle-core' : ''}
        />

        {/* Outer Precision Guide Ring (Subtle) */}
        <circle
          cx="110"
          cy="118"
          r="86"
          fill="none"
          stroke="#27272A"
          strokeWidth="1"
          strokeDasharray="4 8"
        />

        {/* Layer 1: Primary Outer Triangle (Fades In and Out) */}
        <g
          className={pulsing ? 'animate-triangle-fade' : ''}
          style={{ transformOrigin: '110px 118px' }}
        >
          <polygon
            points="110,24 196,172 24,172"
            fill="none"
            stroke="url(#orangeStroke)"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Vertex Accent Ticks */}
          <line x1="110" y1="14" x2="110" y2="24" stroke="#FF6B00" strokeWidth="2" />
          <line x1="204" y1="177" x2="196" y2="172" stroke="#FF6B00" strokeWidth="2" />
          <line x1="16" y1="177" x2="24" y2="172" stroke="#FF6B00" strokeWidth="2" />
        </g>

        {/* Layer 2: Inverted & Mid Geometric Triangle (Counter-Phase Fade In/Out) */}
        <g
          className={pulsing ? 'animate-triangle-inner' : ''}
          style={{ transformOrigin: '110px 118px' }}
        >
          <polygon
            points="110,48 174,158 46,158"
            fill="rgba(249, 115, 22, 0.04)"
            stroke="#F97316"
            strokeWidth="1.5"
            strokeDasharray="14 6"
          />
          {/* Inverted Counter-Triangle */}
          <polygon
            points="110,176 164,82 56,82"
            fill="none"
            stroke="#FB923C"
            strokeWidth="1"
            opacity="0.55"
          />
        </g>

        {/* Layer 3: Inner Core Prism Triangle */}
        <g
          className={pulsing ? 'animate-triangle-core' : ''}
          style={{ transformOrigin: '110px 118px' }}
        >
          <polygon
            points="110,74 148,140 72,140"
            fill="rgba(255, 107, 0, 0.12)"
            stroke="#FF6B00"
            strokeWidth="2"
          />
          <polygon
            points="110,94 130,130 90,130"
            fill="#FF6B00"
            opacity="0.85"
          />
          {/* Center Focal Point */}
          <circle cx="110" cy="118" r="3.5" fill="#FFF7ED" />
        </g>
      </svg>
    </div>
  );
};
