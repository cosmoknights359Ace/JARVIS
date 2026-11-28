import React, { useEffect, useId, useMemo, useRef } from 'react';
import {
  HUD_VIEWBOX,
  HudEngineState,
  computeHudDimensions,
  describeArc,
  generateHexGridPaths,
  generateRadialTicks,
  getHudPlaybackRate,
  polarToCartesian
} from '../utils/hudGeometry';

export type { HudEngineState };

export interface JarvisHudCoreProps {
  size?: number;
  engineState?: HudEngineState;
  isThinking?: boolean;
  className?: string;
}

const { width: VB_W, height: VB_H, cx: CX, cy: CY } = HUD_VIEWBOX;

export const JarvisHudCore: React.FC<JarvisHudCoreProps> = ({
  size = 280,
  engineState,
  isThinking = false,
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const innerRingRef = useRef<SVGGElement>(null);
  const middleRingRef = useRef<SVGGElement>(null);
  const outerRingRef = useRef<SVGGElement>(null);

  const resolvedState: HudEngineState = engineState ?? (isThinking ? 'thinking' : 'ready');

  // Smoothly modulate CSS ring rotation speed via Web Animations playbackRate (zero rotation jump)
  useEffect(() => {
    const targetRate = getHudPlaybackRate(resolvedState);
    const nodes = [innerRingRef.current, middleRingRef.current, outerRingRef.current];

    const applyPlaybackRate = () => {
      for (const node of nodes) {
        if (!node || typeof node.getAnimations !== 'function') continue;
        try {
          for (const anim of node.getAnimations()) {
            if (typeof anim.updatePlaybackRate === 'function') {
              anim.updatePlaybackRate(targetRate);
            } else {
              anim.playbackRate = targetRate;
            }
          }
        } catch {
          // Fallback handled gracefully by CSS
        }
      }
    };

    applyPlaybackRate();
    const rafId = window.requestAnimationFrame(applyPlaybackRate);
    return () => window.cancelAnimationFrame(rafId);
  }, [resolvedState]);

  const dimensions = useMemo(() => computeHudDimensions(size), [size]);

  const geometry = useMemo(() => {
    const hexPaths = generateHexGridPaths(CX, CY, 74, 7.6);

    // Inner ring (clockwise 18s): thin cyan ring + micro-ticks + orange accent arc
    const innerCyanTicksTopRight = generateRadialTicks(CX, CY, 81.5, 85.2, 6, 134, 42);
    const innerCyanTicksBottom = generateRadialTicks(CX, CY, 82, 85, 146, 184, 14);
    const innerOrangeTicksLeft = generateRadialTicks(CX, CY, 81.5, 85.2, 198, 286, 30);

    const innerCyanMainArc = describeArc(CX, CY, 87, 62, 357);
    const innerOrangeAccentArc = describeArc(CX, CY, 87, 5, 57);
    const innerSubArc = describeArc(CX, CY, 92, 22, 74);
    const innerSubArcBottom = describeArc(CX, CY, 92, 195, 255);

    const innerAccentDots = [
      { ...polarToCartesian(CX, CY, 87, 0), color: '#F97316', r: 2.3 },
      { ...polarToCartesian(CX, CY, 87, 57), color: '#F97316', r: 1.9 },
      { ...polarToCartesian(CX, CY, 87, 180), color: '#F97316', r: 2.0 },
      { ...polarToCartesian(CX, CY, 87, 268), color: '#F97316', r: 2.0 }
    ];

    // Middle ring (counter-clockwise 12s): 4 bold glowing cyan segmented curved blocks
    const middleBlocks = [
      describeArc(CX, CY, 106.5, 232, 353), // Long left sweeping block
      describeArc(CX, CY, 106.5, 8, 56),    // Upper-right block
      describeArc(CX, CY, 106.5, 66, 176),  // Long right-bottom sweeping block
      describeArc(CX, CY, 106.5, 188, 224)  // Lower-left block
    ];
    const middleOuterCompanionBlocks = [
      describeArc(CX, CY, 123, 318, 356),
      describeArc(CX, CY, 123, 200, 246)
    ];

    // Outer ring (clockwise 26s): thin cyan arcs + dashed radar ticks + orange curved accent
    const outerThinArcs = [
      describeArc(CX, CY, 136, 268, 358),
      describeArc(CX, CY, 136, 7, 96),
      describeArc(CX, CY, 136, 156, 248)
    ];
    const outerThickCyanCaps = [
      describeArc(CX, CY, 137.5, 7, 42),
      describeArc(CX, CY, 137.5, 204, 244)
    ];
    const outerOrangeAccentArc = describeArc(CX, CY, 136, 112, 152);

    const outerRadarTicksUpperLeft = generateRadialTicks(CX, CY, 148, 158.5, 276, 355, 42);
    const outerRadarTicksUpperRight = generateRadialTicks(CX, CY, 146.5, 152.5, 6, 78, 44);
    const outerRadarTicksLowerRight = generateRadialTicks(CX, CY, 148, 158.5, 106, 176, 38);

    // 5 small vertical orange status bars on each side (cleanly below outer wing traces)
    const leftStatusBarXs = [120, 126, 132, 138, 144];
    const rightStatusBarXs = [514, 520, 526, 532, 538];

    return {
      hexPaths,
      innerCyanTicksTopRight,
      innerCyanTicksBottom,
      innerOrangeTicksLeft,
      innerCyanMainArc,
      innerOrangeAccentArc,
      innerSubArc,
      innerSubArcBottom,
      innerAccentDots,
      middleBlocks,
      middleOuterCompanionBlocks,
      outerThinArcs,
      outerThickCyanCaps,
      outerOrangeAccentArc,
      outerRadarTicksUpperLeft,
      outerRadarTicksUpperRight,
      outerRadarTicksLowerRight,
      leftStatusBarXs,
      rightStatusBarXs
    };
  }, []);

  const ids = {
    coreBg: `${uid}-core-bg`,
    coreClip: `${uid}-core-clip`,
    hexMaskGrad: `${uid}-hex-mask-grad`,
    hexMask: `${uid}-hex-mask`,
    cyanGlow: `${uid}-cyan-glow`,
    cyanStrong: `${uid}-cyan-strong`,
    orangeGlow: `${uid}-orange-glow`,
    textGlow: `${uid}-text-glow`,
    blockGrad: `${uid}-block-grad`
  };

  const stateClass =
    resolvedState === 'offline'
      ? 'jarvis-hud-offline'
      : resolvedState === 'thinking'
      ? 'jarvis-hud-thinking'
      : 'jarvis-hud-ready';

  const ariaLabel =
    resolvedState === 'offline'
      ? 'J.A.R.V.I.S. HUD Core offline standby'
      : resolvedState === 'thinking'
      ? 'J.A.R.V.I.S. HUD Core processing'
      : 'J.A.R.V.I.S. HUD Core ready';

  return (
    <div
      data-testid="jarvis-hud-core"
      data-engine-state={resolvedState}
      data-thinking={resolvedState === 'thinking' ? 'true' : 'false'}
      role="img"
      aria-label={ariaLabel}
      className={`jarvis-hud-core relative inline-flex items-center justify-center select-none pointer-events-none max-w-full ${stateClass} ${className}`}
      style={{
        width: dimensions.width,
        maxWidth: '100%',
        aspectRatio: `${VB_W} / ${VB_H}`
      }}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-full overflow-visible block"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Deep Obsidian-to-Cyan Inner Core Radial Fill */}
          <radialGradient id={ids.coreBg} cx="50%" cy="50%" r="52%">
            <stop offset="0%" stopColor="#020509" stopOpacity="0.98" />
            <stop offset="68%" stopColor="#040E18" stopOpacity="0.96" />
            <stop offset="92%" stopColor="#0B263B" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.28" />
          </radialGradient>

          {/* Luminous Cyan Gradient for Middle Segmented Arcs */}
          <linearGradient id={ids.blockGrad} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7DD3FC" />
            <stop offset="48%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>

          {/* Clip Path for Center Core Hex Grid */}
          <clipPath id={ids.coreClip}>
            <circle cx={CX} cy={CY} r={73.5} />
          </clipPath>

          {/* Soft Radial Mask so Hex Grid is Subtle Behind Text & Visible Near Edges */}
          <radialGradient id={ids.hexMaskGrad} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.12" />
            <stop offset="48%" stopColor="#FFFFFF" stopOpacity="0.34" />
            <stop offset="86%" stopColor="#FFFFFF" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.22" />
          </radialGradient>
          <mask id={ids.hexMask}>
            <circle cx={CX} cy={CY} r={74} fill={`url(#${ids.hexMaskGrad})`} />
          </mask>

          {/* Crisp Cyan HUD Bloom */}
          <filter id={ids.cyanGlow} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="2.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Intense Cyan Glow for Bold Middle Segmented Arcs */}
          <filter id={ids.cyanStrong} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5.2" result="blurOuter" />
            <feGaussianBlur stdDeviation="1.8" result="blurInner" />
            <feMerge>
              <feMergeNode in="blurOuter" />
              <feMergeNode in="blurInner" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Vibrant Orange Accent Glow */}
          <filter id={ids.orangeGlow} x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Crisp White-Cyan Text Glow */}
          <filter id={ids.textGlow} x="-30%" y="-60%" width="160%" height="220%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="#38BDF8" floodOpacity="0.88" />
            <feDropShadow dx="0" dy="0" stdDeviation="1.1" floodColor="#E0F7FF" floodOpacity="0.75" />
          </filter>
        </defs>

        {/* ================================================================ */}
        {/* 1. STATIC SIDE CIRCUIT TRACES (Left & Right) + 5 Orange Bars     */}
        {/* ================================================================ */}
        <g className="hud-circuit-pulse">
          {/* Left Circuit Traces (anchored cleanly outside outer rotating ticks r=158.5) */}
          <g className="hud-cyan-layer" fill="none" stroke="#38BDF8" strokeLinecap="round" strokeLinejoin="round">
            {/* Upper-most diagonal trace */}
            <path
              d="M 164 162 L 116 162 L 98 144 L 46 144"
              strokeWidth="1.25"
              opacity="0.84"
            />
            {/* Upper-mid trace */}
            <path
              d="M 162 169 L 122 169 L 109 156 L 74 156"
              strokeWidth="1.05"
              opacity="0.64"
            />
            {/* Center-upper thin trace */}
            <path
              d="M 160 174 L 96 174 L 88 167 L 42 167"
              strokeWidth="0.95"
              opacity="0.52"
            />
            {/* Center main horizontal bus */}
            <path
              d="M 161 179 L 28 179"
              strokeWidth="1.35"
              opacity="0.88"
            />
            {/* Lower-mid spur */}
            <path
              d="M 163 185 L 110 185 L 96 196 L 56 196"
              strokeWidth="1.15"
              opacity="0.74"
            />
            {/* Lower PCB dog-leg loop */}
            <path
              d="M 165 190 L 106 190 L 88 210 L 44 210 L 34 200 L 34 192 L 64 192"
              strokeWidth="1.0"
              opacity="0.48"
            />
            {/* Lower connector under status bars */}
            <path
              d="M 168 199 L 112 199"
              strokeWidth="1.05"
              opacity="0.6"
            />
          </g>

          {/* Left Circuit Nodes (Cyan & Orange) */}
          <g className="hud-cyan-layer" filter={`url(#${ids.cyanGlow})`}>
            <circle cx={44} cy={144} r={2.8} fill="#7DD3FC" />
            <circle cx={66} cy={144} r={1.3} fill="#38BDF8" />
            <circle cx={72} cy={156} r={2.4} fill="#070709" stroke="#38BDF8" strokeWidth="1.25" />
            <circle cx={24} cy={179} r={4.2} fill="#070709" stroke="#38BDF8" strokeWidth="1.5" />
            <circle cx={54} cy={196} r={1.8} fill="#38BDF8" />
            <circle cx={111} cy={199} r={1.6} fill="#38BDF8" />
          </g>
          <g className="hud-orange-accent" filter={`url(#${ids.orangeGlow})`}>
            <circle cx={64} cy={179} r={3.1} fill="#F97316" />
            {geometry.leftStatusBarXs.map((x) => (
              <rect
                key={`left-bar-${x}`}
                x={x}
                y={191}
                width={2.2}
                height={8.5}
                rx={0.9}
                fill="#F97316"
              />
            ))}
          </g>

          {/* Right Circuit Traces (Symmetrical Counterpart) */}
          <g className="hud-cyan-layer" fill="none" stroke="#38BDF8" strokeLinecap="round" strokeLinejoin="round">
            {/* Upper-most diagonal trace */}
            <path
              d="M 496 162 L 544 162 L 562 144 L 614 144"
              strokeWidth="1.25"
              opacity="0.84"
            />
            {/* Upper-mid orange-node trace */}
            <path
              d="M 498 169 L 538 169 L 551 156 L 594 156"
              strokeWidth="1.05"
              opacity="0.66"
            />
            {/* Center main horizontal bus */}
            <path
              d="M 499 174 L 632 174"
              strokeWidth="1.35"
              opacity="0.88"
            />
            {/* Center-lower thin trace */}
            <path
              d="M 500 180 L 564 180 L 574 185 L 604 185"
              strokeWidth="0.95"
              opacity="0.54"
            />
            {/* Lower-mid trace */}
            <path
              d="M 497 186 L 550 186 L 564 196 L 588 196"
              strokeWidth="1.15"
              opacity="0.74"
            />
            {/* Lower diagonal tail */}
            <path
              d="M 495 191 L 552 191 L 568 206 L 618 206"
              strokeWidth="1.0"
              opacity="0.52"
            />
            {/* Outer-right thin bar extension */}
            <path
              d="M 548 196 L 638 196"
              strokeWidth="0.95"
              opacity="0.56"
            />
          </g>

          {/* Right Circuit Nodes (Cyan & Orange) */}
          <g className="hud-cyan-layer" filter={`url(#${ids.cyanGlow})`}>
            <circle cx={616} cy={144} r={2.8} fill="#7DD3FC" />
            <circle cx={636} cy={174} r={4.2} fill="#070709" stroke="#38BDF8" strokeWidth="1.5" />
            <circle cx={604} cy={185} r={1.6} fill="#38BDF8" />
            <circle cx={588} cy={196} r={2.4} fill="#070709" stroke="#38BDF8" strokeWidth="1.25" />
            <circle cx={639} cy={196} r={1.8} fill="#38BDF8" />
          </g>
          <g className="hud-orange-accent" filter={`url(#${ids.orangeGlow})`}>
            <circle cx={596} cy={156} r={3.1} fill="#F97316" />
            {geometry.rightStatusBarXs.map((x) => (
              <rect
                key={`right-bar-${x}`}
                x={x}
                y={191}
                width={2.2}
                height={8.5}
                rx={0.9}
                fill="#F97316"
              />
            ))}
          </g>
        </g>

        {/* ================================================================ */}
        {/* 2. OUTER RING (Clockwise — 26s linear infinite)                  */}
        {/* ================================================================ */}
        <g
          ref={outerRingRef}
          data-testid="hud-ring-outer"
          className="hud-ring-outer"
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        >
          {/* Thin Outer Cyan Arc Segments */}
          <g className="hud-cyan-layer" fill="none" stroke="#38BDF8" filter={`url(#${ids.cyanGlow})`}>
            {geometry.outerThinArcs.map((d, idx) => (
              <path
                key={`outer-thin-${idx}`}
                d={d}
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.88"
              />
            ))}
            {geometry.outerThickCyanCaps.map((d, idx) => (
              <path
                key={`outer-cap-${idx}`}
                d={d}
                strokeWidth="4.4"
                strokeLinecap="butt"
                opacity="0.82"
              />
            ))}
          </g>

          {/* Bright Orange Curved Accent Segment (Lower-Right) */}
          <path
            className="hud-orange-accent"
            d={geometry.outerOrangeAccentArc}
            fill="none"
            stroke="#F97316"
            strokeWidth="3.6"
            strokeLinecap="round"
            filter={`url(#${ids.orangeGlow})`}
          />

          {/* Outer Dashed Radar Tick-Marks */}
          <g className="hud-cyan-layer" stroke="#38BDF8" strokeLinecap="round">
            {geometry.outerRadarTicksUpperLeft.map((t, i) => (
              <line
                key={`rad-ul-${i}`}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                strokeWidth={i % 6 === 0 ? '1.6' : '1.15'}
                opacity={i % 6 === 0 ? '0.95' : '0.68'}
              />
            ))}
            {geometry.outerRadarTicksUpperRight.map((t, i) => (
              <line
                key={`rad-ur-${i}`}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                strokeWidth="0.95"
                opacity="0.58"
              />
            ))}
            {geometry.outerRadarTicksLowerRight.map((t, i) => (
              <line
                key={`rad-lr-${i}`}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                strokeWidth={i % 5 === 0 ? '1.6' : '1.15'}
                opacity={i % 5 === 0 ? '0.95' : '0.68'}
              />
            ))}
          </g>
        </g>

        {/* ================================================================ */}
        {/* 3. MIDDLE RING (Counter-Clockwise — 12s linear infinite)         */}
        {/* ================================================================ */}
        <g
          ref={middleRingRef}
          data-testid="hud-ring-middle"
          className="hud-ring-middle"
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        >
          <g className="hud-cyan-layer">
            {/* Hairline Tracking Rails */}
            <circle
              cx={CX}
              cy={CY}
              r={97}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="0.8"
              strokeDasharray="18 10 6 12"
              opacity="0.35"
            />
            <circle
              cx={CX}
              cy={CY}
              r={116}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="0.9"
              strokeDasharray="44 18 12 24"
              opacity="0.42"
            />

            {/* Secondary Outer Muted Cyan Companion Arcs */}
            <g fill="none" stroke="#38BDF8" opacity="0.42">
              {geometry.middleOuterCompanionBlocks.map((d, idx) => (
                <path key={`mid-comp-${idx}`} d={d} strokeWidth="5.4" strokeLinecap="butt" />
              ))}
            </g>

            {/* 4 Bold Glowing Cyan Segmented Arcs */}
            <g fill="none" filter={`url(#${ids.cyanStrong})`}>
              {geometry.middleBlocks.map((d, idx) => (
                <React.Fragment key={`mid-block-${idx}`}>
                  <path
                    d={d}
                    stroke={`url(#${ids.blockGrad})`}
                    strokeWidth="11.5"
                    strokeLinecap="butt"
                  />
                  {/* Crisp Inner Luminous Core Highlight */}
                  <path
                    d={d}
                    stroke="#E0F7FF"
                    strokeWidth="3.2"
                    strokeLinecap="butt"
                    opacity="0.58"
                  />
                </React.Fragment>
              ))}
            </g>
          </g>
        </g>

        {/* ================================================================ */}
        {/* 4. INNER RING (Clockwise — 18s linear infinite)                  */}
        {/* ================================================================ */}
        <g
          ref={innerRingRef}
          data-testid="hud-ring-inner"
          className="hud-ring-inner"
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        >
          <g className="hud-cyan-layer">
            {/* Thin Glowing Cyan Ring */}
            <path
              d={geometry.innerCyanMainArc}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="1.9"
              strokeLinecap="round"
              filter={`url(#${ids.cyanGlow})`}
            />
            <path
              d={geometry.innerSubArc}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="0.9"
              opacity="0.55"
            />
            <path
              d={geometry.innerSubArcBottom}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="0.9"
              opacity="0.5"
            />

            {/* Fine Cyan Micro-Ticks */}
            <g stroke="#38BDF8" strokeLinecap="round" opacity="0.82">
              {geometry.innerCyanTicksTopRight.map((t, i) => (
                <line
                  key={`in-tr-${i}`}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  strokeWidth={i % 5 === 0 ? '1.25' : '0.85'}
                />
              ))}
              {geometry.innerCyanTicksBottom.map((t, i) => (
                <line
                  key={`in-bt-${i}`}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  strokeWidth="0.85"
                />
              ))}
            </g>
          </g>

          {/* Lower-Left Orange Micro-Ticks + Accent Arc + Anchor Nodes */}
          <g className="hud-orange-accent">
            <g stroke="#F97316" strokeLinecap="round" opacity="0.88">
              {geometry.innerOrangeTicksLeft.map((t, i) => (
                <line
                  key={`in-or-${i}`}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  strokeWidth={i % 6 === 0 ? '1.3' : '0.85'}
                />
              ))}
            </g>
            <path
              d={geometry.innerOrangeAccentArc}
              fill="none"
              stroke="#F97316"
              strokeWidth="2.9"
              strokeLinecap="round"
              filter={`url(#${ids.orangeGlow})`}
            />
            <g filter={`url(#${ids.orangeGlow})`}>
              {geometry.innerAccentDots.map((dot, idx) => (
                <circle key={`in-dot-${idx}`} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.color} />
              ))}
            </g>
          </g>
        </g>

        {/* ================================================================ */}
        {/* 5. STATIC CENTER CORE (Dark Core + Hex Grid + Stationary Text)   */}
        {/* ================================================================ */}
        <g data-testid="hud-center-core">
          {/* Dark Obsidian Circular Backdrop */}
          <circle cx={CX} cy={CY} r={74} fill={`url(#${ids.coreBg})`} />

          {/* Subtle Hexagonal Grid Overlay Clipped Inside Core */}
          <g className="hud-cyan-layer" clipPath={`url(#${ids.coreClip})`} mask={`url(#${ids.hexMask})`}>
            <g fill="none" stroke="#38BDF8" strokeWidth="0.65" opacity="0.24">
              {geometry.hexPaths.map((d, idx) => (
                <path key={`hex-${idx}`} d={d} />
              ))}
            </g>
          </g>

          {/* Crisp Stationary Core Rim */}
          <g className="hud-cyan-layer">
            <circle
              cx={CX}
              cy={CY}
              r={74}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="1.75"
              opacity="0.92"
              filter={`url(#${ids.cyanGlow})`}
            />
            <circle
              cx={CX}
              cy={CY}
              r={70.5}
              fill="none"
              stroke="#7DD3FC"
              strokeWidth="0.65"
              opacity="0.32"
            />
          </g>

          {/* Stationary Centered Glowing White-Cyan J.A.R.V.I.S. Text */}
          <text
            className="hud-core-text"
            x={CX + 1.2}
            y={CY + 0.5}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#F4FCFF"
            filter={`url(#${ids.textGlow})`}
            style={{
              fontFamily: "var(--font-display), 'Outfit', sans-serif",
              fontWeight: 700,
              fontSize: '18.5px',
              letterSpacing: '0.12em'
            }}
          >
            J.A.R.V.I.S.
          </text>
        </g>
      </svg>
    </div>
  );
};
