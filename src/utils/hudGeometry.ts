export const HUD_VIEWBOX = {
  width: 660,
  height: 350,
  cx: 330,
  cy: 175
} as const;

export interface Point2D {
  x: number;
  y: number;
}

export interface RadialTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angleDeg: number;
}

export interface HudDimensions {
  width: number;
  height: number;
}

const roundCoord = (value: number): number => Math.round(value * 100) / 100;

/**
 * Converts polar coordinates to SVG cartesian coordinates.
 * 0 degrees points straight up (12 o'clock) and increases clockwise.
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number
): Point2D {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: roundCoord(cx + radius * Math.cos(rad)),
    y: roundCoord(cy + radius * Math.sin(rad))
  };
}

/**
 * Builds an SVG arc path string from startAngleDeg to endAngleDeg (clockwise).
 */
export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const start = polarToCartesian(cx, cy, radius, startAngleDeg);
  const end = polarToCartesian(cx, cy, radius, endAngleDeg);
  const sweep = ((endAngleDeg - startAngleDeg) % 360 + 360) % 360;
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${roundCoord(radius)} ${roundCoord(radius)} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

/**
 * Generates evenly spaced radial tick line segments between startAngleDeg and endAngleDeg.
 */
export function generateRadialTicks(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  count: number
): RadialTick[] {
  if (count <= 0) return [];
  const ticks: RadialTick[] = [];
  const step = count === 1 ? 0 : (endAngleDeg - startAngleDeg) / (count - 1);

  for (let i = 0; i < count; i++) {
    const angleDeg = startAngleDeg + i * step;
    const inner = polarToCartesian(cx, cy, innerRadius, angleDeg);
    const outer = polarToCartesian(cx, cy, outerRadius, angleDeg);
    ticks.push({
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      angleDeg: roundCoord(angleDeg)
    });
  }

  return ticks;
}

/**
 * Generates pointy-top hexagon polygon paths covering a circular region of `radius`.
 */
export function generateHexGridPaths(
  cx: number,
  cy: number,
  radius: number,
  hexRadius: number
): string[] {
  if (radius <= 0 || hexRadius <= 0) return [];

  const paths: string[] = [];
  const dx = Math.sqrt(3) * hexRadius;
  const dy = 1.5 * hexRadius;
  const maxCols = Math.ceil((radius + hexRadius) / dx) + 1;
  const maxRows = Math.ceil((radius + hexRadius) / dy) + 1;

  for (let row = -maxRows; row <= maxRows; row++) {
    const y = cy + row * dy;
    const xOffset = Math.abs(row) % 2 === 1 ? dx / 2 : 0;

    for (let col = -maxCols; col <= maxCols; col++) {
      const x = cx + col * dx + xOffset;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > radius + hexRadius) continue;

      const vertices: string[] = [];
      for (let corner = 0; corner < 6; corner++) {
        const rad = ((60 * corner - 30) * Math.PI) / 180;
        const vx = roundCoord(x + hexRadius * Math.cos(rad));
        const vy = roundCoord(y + hexRadius * Math.sin(rad));
        vertices.push(`${corner === 0 ? 'M' : 'L'} ${vx} ${vy}`);
      }
      paths.push(`${vertices.join(' ')} Z`);
    }
  }

  return paths;
}

/**
 * Computes responsive container dimensions preserving the HUD + side circuit aspect ratio.
 * `size` controls the vertical HUD height (default 280px).
 */
export function computeHudDimensions(size = 280): HudDimensions {
  const safeHeight = Number.isFinite(size) ? Math.min(Math.max(size, 80), 1200) : 280;
  const aspect = HUD_VIEWBOX.width / HUD_VIEWBOX.height;
  return {
    width: Math.round(safeHeight * aspect),
    height: Math.round(safeHeight)
  };
}

export type HudEngineState = 'offline' | 'ready' | 'thinking';

export interface WelcomeStatusInfo {
  kind: 'offline' | 'warming' | 'ready';
  label: string;
}

/**
 * Derives the live HUD Core animation/glow state from streaming, warm-up, and provider status.
 */
export function resolveHudEngineState(params: {
  isStreaming: boolean;
  warmUpStatus?: 'idle' | 'warming' | 'ready' | 'failed' | 'skipped';
  activeProvider: 'ollama' | 'gemini' | 'offline';
}): HudEngineState {
  if (params.isStreaming || params.warmUpStatus === 'warming') {
    return 'thinking';
  }
  if (params.activeProvider === 'offline') {
    return 'offline';
  }
  return 'ready';
}

/**
 * Returns the Web Animations playbackRate multiplier for each HUD engine state:
 * - offline: 2.5x slower (0.4)
 * - ready: steady baseline (1.0)
 * - thinking: 2.5x faster (2.5)
 */
export function getHudPlaybackRate(state: HudEngineState): number {
  switch (state) {
    case 'offline':
      return 0.4;
    case 'thinking':
      return 2.5;
    case 'ready':
    default:
      return 1;
  }
}

/**
 * Formats the clean welcome-screen status readout under "At your service, Sir.".
 * Never displays ping latency when offline and avoids duplicate "Engine" wording.
 */
export function formatWelcomeStatus(params: {
  activeProvider: 'ollama' | 'gemini' | 'offline';
  warmUpStatus?: 'idle' | 'warming' | 'ready' | 'failed' | 'skipped';
  warmUpModel?: string | null;
  resolvedModel: string;
  fallbackModel: string;
  probeLatencyMs: number | null;
}): WelcomeStatusInfo {
  if (params.warmUpStatus === 'warming') {
    const targetModel = params.warmUpModel || params.resolvedModel || params.fallbackModel;
    return {
      kind: 'warming',
      label: `Warming up ${targetModel}...`
    };
  }

  if (params.activeProvider === 'offline') {
    return {
      kind: 'offline',
      label: 'Offline'
    };
  }

  const activeModel = params.resolvedModel || params.fallbackModel;
  const pingSuffix =
    typeof params.probeLatencyMs === 'number' && Number.isFinite(params.probeLatencyMs)
      ? ` · ${Math.round(params.probeLatencyMs)}ms`
      : '';

  return {
    kind: 'ready',
    label: `Online · ${activeModel}${pingSuffix}`
  };
}
