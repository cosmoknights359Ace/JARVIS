import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUD_VIEWBOX,
  polarToCartesian,
  describeArc,
  generateRadialTicks,
  generateHexGridPaths,
  computeHudDimensions,
  resolveHudEngineState,
  getHudPlaybackRate,
  formatWelcomeStatus
} from './hudGeometry';

test('polarToCartesian maps cardinal angles with 0 deg at 12 o clock', () => {
  assert.deepEqual(polarToCartesian(100, 100, 50, 0), { x: 100, y: 50 });
  assert.deepEqual(polarToCartesian(100, 100, 50, 90), { x: 150, y: 100 });
  assert.deepEqual(polarToCartesian(100, 100, 50, 180), { x: 100, y: 150 });
  assert.deepEqual(polarToCartesian(100, 100, 50, 270), { x: 50, y: 100 });
});

test('describeArc sets large-arc flag accurately for minor and major sweeps', () => {
  const smallArc = describeArc(310, 175, 100, 10, 80);
  assert.match(smallArc, /^M .* A 100 100 0 0 1 /);

  const largeArc = describeArc(310, 175, 100, 0, 210);
  assert.match(largeArc, /^M .* A 100 100 0 1 1 /);
});

test('generateRadialTicks produces exact count and bounds', () => {
  const ticks = generateRadialTicks(310, 175, 148, 158, 270, 350, 21);
  assert.equal(ticks.length, 21);
  assert.equal(ticks[0].angleDeg, 270);
  assert.equal(ticks[20].angleDeg, 350);
  assert.equal(generateRadialTicks(310, 175, 148, 158, 0, 90, 0).length, 0);
});

test('generateHexGridPaths produces closed SVG hexagon paths within core radius', () => {
  const hexes = generateHexGridPaths(HUD_VIEWBOX.cx, HUD_VIEWBOX.cy, 74, 8);
  assert.ok(hexes.length > 40, `Expected >40 hexagons, got ${hexes.length}`);
  for (const d of hexes) {
    assert.ok(d.startsWith('M '), 'Each hex path must start with M');
    assert.ok(d.endsWith(' Z'), 'Each hex path must be closed with Z');
  }
});

test('computeHudDimensions preserves aspect ratio and clamps extreme values', () => {
  const standard = computeHudDimensions(280);
  assert.equal(standard.height, 280);
  assert.equal(standard.width, Math.round(280 * (HUD_VIEWBOX.width / HUD_VIEWBOX.height)));

  assert.equal(computeHudDimensions(10).height, 80);
  assert.equal(computeHudDimensions(5000).height, 1200);
  assert.equal(computeHudDimensions(Number.NaN).height, 280);
});

test('resolveHudEngineState and getHudPlaybackRate map all three engine states', () => {
  assert.equal(
    resolveHudEngineState({ isStreaming: false, warmUpStatus: 'idle', activeProvider: 'offline' }),
    'offline'
  );
  assert.equal(
    resolveHudEngineState({ isStreaming: false, warmUpStatus: 'ready', activeProvider: 'ollama' }),
    'ready'
  );
  assert.equal(
    resolveHudEngineState({ isStreaming: true, warmUpStatus: 'ready', activeProvider: 'ollama' }),
    'thinking'
  );
  assert.equal(
    resolveHudEngineState({ isStreaming: false, warmUpStatus: 'warming', activeProvider: 'ollama' }),
    'thinking'
  );

  assert.equal(getHudPlaybackRate('offline'), 0.4);
  assert.equal(getHudPlaybackRate('ready'), 1);
  assert.equal(getHudPlaybackRate('thinking'), 2.5);
});

test('formatWelcomeStatus hides ping when offline and formats ready/warming cleanly', () => {
  const offline = formatWelcomeStatus({
    activeProvider: 'offline',
    warmUpStatus: 'idle',
    resolvedModel: 'qwen2.5:3b',
    fallbackModel: 'qwen2.5:3b',
    probeLatencyMs: 4
  });
  assert.deepEqual(offline, { kind: 'offline', label: 'Offline' });

  const online = formatWelcomeStatus({
    activeProvider: 'ollama',
    warmUpStatus: 'ready',
    resolvedModel: 'qwen2.5:3b',
    fallbackModel: 'qwen2.5:3b',
    probeLatencyMs: 130
  });
  assert.deepEqual(online, { kind: 'ready', label: 'Online · qwen2.5:3b · 130ms' });

  const warming = formatWelcomeStatus({
    activeProvider: 'ollama',
    warmUpStatus: 'warming',
    warmUpModel: 'qwen2.5-coder:7b',
    resolvedModel: 'qwen2.5:3b',
    fallbackModel: 'qwen2.5:3b',
    probeLatencyMs: 25
  });
  assert.deepEqual(warming, { kind: 'warming', label: 'Warming up qwen2.5-coder:7b...' });
});
