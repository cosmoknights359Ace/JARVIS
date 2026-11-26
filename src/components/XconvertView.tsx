import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeftRight,
  FolderPlus,
  FolderOpen,
  Play,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  Info,
  Image,
  FileText,
  Database,
  Film,
  Archive
} from 'lucide-react';
import {
  XconvertCategory,
  XconvertQueueItem,
  formatFileSize,
  getDefaultTargetFormat,
  getSharedCategoryBatchTargets,
  getRequiredMissingEngineHint
} from '../utils/xconvertHelpers';

interface XconvertCapabilitiesResponse {
  engines: Record<string, boolean>;
  install_hint: string;
}

interface XconvertInspectedFile {
  path: string;
  name: string;
  ext: string;
  size_bytes: number;
  category: XconvertCategory;
  compatible_targets: string[];
}

interface XconvertBatchJob {
  input_path: string;
  target_format: string;
  output_dir: string | null;
}

interface XconvertBatchResult {
  input_path: string;
  output_path: string | null;
  ok: boolean;
  error: string | null;
  duration_ms: number;
}

interface XconvertDesktopBridge {
  xconvert_capabilities: () => Promise<XconvertCapabilitiesResponse>;
  xconvert_pick_files: () => Promise<XconvertInspectedFile[]>;
  xconvert_pick_output_dir: () => Promise<string | null>;
  xconvert_run_batch: (jobs: XconvertBatchJob[]) => Promise<XconvertBatchResult[]>;
  xconvert_open_in_explorer: (path: string) => Promise<{ ok: boolean; error?: string }>;
}

function getXconvertBridge(): XconvertDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (
    window as unknown as { pywebview?: { api?: Partial<XconvertDesktopBridge> } }
  ).pywebview?.api;
  if (
    api &&
    typeof api.xconvert_pick_files === 'function' &&
    typeof api.xconvert_run_batch === 'function'
  ) {
    return api as XconvertDesktopBridge;
  }
  return null;
}

const CATEGORY_META: Record<
  XconvertCategory,
  { label: string; className: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  image: {
    label: 'Image',
    className: 'bg-orange-500/12 text-orange-300 border-orange-500/30',
    icon: Image
  },
  document: {
    label: 'Document',
    className: 'bg-sky-500/12 text-sky-300 border-sky-500/30',
    icon: FileText
  },
  data: {
    label: 'Data',
    className: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30',
    icon: Database
  },
  media: {
    label: 'Media',
    className: 'bg-violet-500/12 text-violet-300 border-violet-500/30',
    icon: Film
  },
  archive: {
    label: 'Archive',
    className: 'bg-amber-500/12 text-amber-300 border-amber-500/30',
    icon: Archive
  },
  unsupported: {
    label: 'Unsupported',
    className: 'bg-zinc-800/80 text-zinc-400 border-zinc-700',
    icon: AlertCircle
  }
};

const SUPPORTED_GROUPS = [
  { label: 'Images', formats: 'PNG · JPG · WEBP · BMP · TIFF · GIF · ICO · PDF' },
  { label: 'Documents', formats: 'PDF · DOCX · TXT · MD · HTML' },
  { label: 'Data', formats: 'CSV · XLSX · JSON · YAML · XML' },
  { label: 'Media', formats: 'MP4 · MKV · MOV · AVI · WEBM · MP3 · WAV · FLAC · OGG · M4A · GIF' },
  { label: 'Archives', formats: 'ZIP · TAR · TAR.GZ · 7Z' }
];

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const XconvertView: React.FC = () => {
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean>(() => getXconvertBridge() !== null);
  const [capabilities, setCapabilities] = useState<XconvertCapabilitiesResponse | null>(null);
  const [queue, setQueue] = useState<XconvertQueueItem[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [copiedHint, setCopiedHint] = useState<boolean>(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const loadCapabilities = useCallback(async () => {
    const bridge = getXconvertBridge();
    if (!bridge) {
      setBridgeAvailable(false);
      return;
    }
    setBridgeAvailable(true);
    try {
      if (typeof bridge.xconvert_capabilities === 'function') {
        const caps = await bridge.xconvert_capabilities();
        if (caps && typeof caps === 'object' && caps.engines) {
          setCapabilities(caps);
        }
      }
    } catch {
      // capabilities check is advisory; do not block UI
    }
  }, []);

  useEffect(() => {
    void loadCapabilities();
    const onReady = () => {
      void loadCapabilities();
    };
    window.addEventListener('pywebviewready', onReady);
    return () => window.removeEventListener('pywebviewready', onReady);
  }, [loadCapabilities]);

  const sharedBatch = useMemo(() => getSharedCategoryBatchTargets(queue), [queue]);

  const missingEngineHint = useMemo(() => {
    return getRequiredMissingEngineHint(queue, capabilities?.engines ?? null);
  }, [queue, capabilities]);

  const convertibleItems = useMemo(
    () =>
      queue.filter(
        (item) =>
          item.category !== 'unsupported' &&
          item.compatibleTargets.length > 0 &&
          Boolean(item.targetFormat)
      ),
    [queue]
  );

  const doneCount = useMemo(() => queue.filter((i) => i.status === 'done').length, [queue]);
  const errorCount = useMemo(() => queue.filter((i) => i.status === 'error').length, [queue]);

  const handleAddFiles = async () => {
    const bridge = getXconvertBridge();
    if (!bridge) {
      setBridgeAvailable(false);
      return;
    }
    setBannerError(null);
    setIsPicking(true);
    try {
      const picked = await bridge.xconvert_pick_files();
      if (!Array.isArray(picked) || picked.length === 0) return;

      setQueue((prev) => {
        const existingPaths = new Set(prev.map((item) => item.path));
        const additions: XconvertQueueItem[] = [];

        for (const file of picked) {
          if (!file || !file.path || existingPaths.has(file.path)) continue;
          existingPaths.add(file.path);
          const targets = Array.isArray(file.compatible_targets) ? file.compatible_targets : [];
          const defaultTarget = getDefaultTargetFormat(file.ext, targets);

          additions.push({
            id: `xc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            path: file.path,
            name: file.name,
            ext: file.ext,
            sizeBytes: typeof file.size_bytes === 'number' ? file.size_bytes : 0,
            category: file.category || 'unsupported',
            compatibleTargets: targets,
            targetFormat: defaultTarget,
            status: file.category === 'unsupported' || targets.length === 0 ? 'error' : 'pending',
            error:
              file.category === 'unsupported' || targets.length === 0
                ? `Unsupported file format (.${file.ext || 'unknown'})`
                : undefined
          });
        }

        return [...prev, ...additions];
      });
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Failed to open file picker.');
    } finally {
      setIsPicking(false);
    }
  };

  const handlePickOutputDir = async () => {
    const bridge = getXconvertBridge();
    if (!bridge || typeof bridge.xconvert_pick_output_dir !== 'function') return;
    setBannerError(null);
    try {
      const selected = await bridge.xconvert_pick_output_dir();
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not select output folder.');
    }
  };

  const handleSetAllTarget = (target: string) => {
    if (!target) return;
    setQueue((prev) =>
      prev.map((item) =>
        item.compatibleTargets.includes(target)
          ? {
              ...item,
              targetFormat: target,
              status: item.status === 'done' || item.status === 'error' ? 'pending' : item.status,
              error: undefined
            }
          : item
      )
    );
  };

  const handleTargetChange = (id: string, target: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              targetFormat: target,
              status: 'pending',
              error: undefined,
              outputPath: undefined,
              durationMs: undefined
            }
          : item
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearQueue = () => {
    if (isConverting) return;
    setQueue([]);
    setBannerError(null);
  };

  const handleConvertAll = async () => {
    const bridge = getXconvertBridge();
    if (!bridge || isConverting) return;

    const toRun = queue.filter(
      (item) =>
        item.category !== 'unsupported' &&
        item.compatibleTargets.length > 0 &&
        Boolean(item.targetFormat)
    );
    if (toRun.length === 0) return;

    const runIds = new Set(toRun.map((i) => i.id));
    setBannerError(null);
    setIsConverting(true);

    setQueue((prev) =>
      prev.map((item) =>
        runIds.has(item.id)
          ? {
              ...item,
              status: 'converting',
              error: undefined,
              outputPath: undefined,
              durationMs: undefined
            }
          : item
      )
    );

    const jobs: XconvertBatchJob[] = toRun.map((item) => ({
      input_path: item.path,
      target_format: item.targetFormat,
      output_dir: outputDir
    }));

    try {
      const results = await bridge.xconvert_run_batch(jobs);
      const resultByIndex = new Map<string, XconvertBatchResult>();
      toRun.forEach((item, idx) => {
        const res = Array.isArray(results) ? results[idx] : undefined;
        if (res) {
          resultByIndex.set(item.id, res);
        }
      });

      setQueue((prev) =>
        prev.map((item) => {
          if (!runIds.has(item.id)) return item;
          const res = resultByIndex.get(item.id);
          if (!res) {
            return {
              ...item,
              status: 'error',
              error: 'No result returned from conversion engine.'
            };
          }
          return {
            ...item,
            status: res.ok ? 'done' : 'error',
            outputPath: res.output_path || undefined,
            error: res.ok ? undefined : res.error || 'Conversion failed.',
            durationMs: typeof res.duration_ms === 'number' ? res.duration_ms : undefined
          };
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Batch conversion failed.';
      setBannerError(message);
      setQueue((prev) =>
        prev.map((item) =>
          runIds.has(item.id)
            ? { ...item, status: 'error', error: message }
            : item
        )
      );
    } finally {
      setIsConverting(false);
    }
  };

  const handleOpenInExplorer = async (outputPath?: string) => {
    if (!outputPath) return;
    const bridge = getXconvertBridge();
    if (!bridge || typeof bridge.xconvert_open_in_explorer !== 'function') return;
    try {
      const res = await bridge.xconvert_open_in_explorer(outputPath);
      if (res && res.ok === false && res.error) {
        setBannerError(res.error);
      }
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : 'Could not open Explorer.');
    }
  };

  const handleCopyHint = async () => {
    if (!missingEngineHint) return;
    try {
      await navigator.clipboard.writeText(missingEngineHint);
      setCopiedHint(true);
      window.setTimeout(() => setCopiedHint(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#070709] text-zinc-100 overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-6 sm:py-8 space-y-5">
        {/* Header Row */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-zinc-900">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-orange-500/12 border border-orange-500/30 flex items-center justify-center shrink-0">
                <ArrowLeftRight size={17} className="text-orange-400" />
              </div>
              <div>
                <h1 className="text-xl font-display font-bold tracking-tight text-zinc-50">
                  Xconvert
                </h1>
                <p className="text-xs text-zinc-400">
                  Local disk-to-disk file converter with zero upload or size limits.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {queue.length > 0 && (
              <button
                type="button"
                onClick={handleClearQueue}
                disabled={isConverting}
                className="px-3 py-2 rounded-lg bg-zinc-900/90 hover:bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              data-testid="xconvert-add-files"
              onClick={handleAddFiles}
              disabled={!bridgeAvailable || isPicking || isConverting}
              className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-orange-500/50 text-xs font-semibold text-zinc-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isPicking ? (
                <Loader2 size={14} className="animate-spin text-orange-400" />
              ) : (
                <FolderPlus size={14} className="text-orange-400" />
              )}
              <span>Add Files</span>
            </button>
          </div>
        </div>

        {/* Subtle Notice when opened in a regular web browser outside pywebview */}
        {!bridgeAvailable && (
          <div
            data-testid="xconvert-browser-notice"
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#0D0D11] border border-zinc-800/90 text-xs text-zinc-400"
          >
            <Info size={14} className="text-orange-400 shrink-0" />
            <span>
              Browser preview detected — native disk-to-disk conversion requires the{' '}
              <span className="text-zinc-200 font-medium">J.A.R.V.I.S desktop app</span>{' '}
              (<code className="font-mono text-orange-300/90">python jarvis_gui.py</code>).
            </span>
          </div>
        )}

        {/* One-line pip install hint ONLY when a queued job needs a missing Python engine */}
        {missingEngineHint && (
          <div
            data-testid="xconvert-pip-hint"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/30 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Terminal size={14} className="text-amber-400 shrink-0" />
              <span className="text-amber-200/90 shrink-0">Missing Python engine:</span>
              <code className="font-mono text-amber-100 bg-black/40 border border-amber-500/20 rounded px-2 py-0.5 truncate">
                {missingEngineHint}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyHint}
              className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0"
            >
              {copiedHint ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedHint ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}

        {bannerError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-xs text-rose-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={14} className="text-rose-400 shrink-0" />
              <span className="truncate">{bannerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              aria-label="Dismiss error"
              className="text-rose-300/80 hover:text-rose-100 p-1"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Batch Controls Bar */}
        <div className="p-4 rounded-xl bg-[#0D0D11] border border-zinc-800/90 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
            {/* Output Folder Picker */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                data-testid="xconvert-pick-output"
                onClick={handlePickOutputDir}
                disabled={!bridgeAvailable || isConverting}
                className="px-3 py-1.5 rounded-lg bg-[#070709] hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-200 disabled:opacity-45 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderOpen size={13} className="text-orange-400" />
                <span>Output Folder</span>
              </button>
              <span
                data-testid="xconvert-output-dir-label"
                title={outputDir || 'Same folder as each source file'}
                className="text-xs font-mono text-zinc-400 truncate max-w-[260px]"
              >
                {outputDir || 'Source file folder'}
              </span>
              {outputDir && (
                <button
                  type="button"
                  onClick={() => setOutputDir(null)}
                  disabled={isConverting}
                  title="Reset to source file's folder"
                  aria-label="Reset output folder to default"
                  className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* "Set All To..." Quick Selector (shown when queued files share a category) */}
            {sharedBatch && (
              <div className="flex items-center gap-2 pl-3 border-l border-zinc-800">
                <label
                  htmlFor="xconvert-set-all"
                  className="text-xs text-zinc-400 whitespace-nowrap"
                >
                  Set All To
                </label>
                <select
                  id="xconvert-set-all"
                  data-testid="xconvert-set-all"
                  defaultValue=""
                  disabled={isConverting}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleSetAllTarget(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="bg-[#070709] border border-zinc-800 hover:border-orange-500/50 rounded-lg px-2.5 py-1.5 text-xs font-mono uppercase text-zinc-100 focus:outline-none focus:border-orange-500 transition-colors"
                >
                  <option value="">Choose format...</option>
                  {sharedBatch.targets.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {fmt.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Primary Orange Convert All CTA */}
          <button
            type="button"
            data-testid="xconvert-convert-all"
            onClick={handleConvertAll}
            disabled={!bridgeAvailable || isConverting || convertibleItems.length === 0}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-black font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-[0_0_20px_rgba(249,115,22,0.22)] shrink-0"
          >
            {isConverting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={13} fill="currentColor" />
            )}
            <span>
              {isConverting
                ? 'Converting...'
                : `Convert All${convertibleItems.length > 0 ? ` (${convertibleItems.length})` : ''}`}
            </span>
          </button>
        </div>

        {/* Queue Section or Empty State */}
        {queue.length === 0 ? (
          <div className="rounded-xl bg-[#0D0D11] border border-zinc-800/80 p-8 sm:p-10 text-center space-y-6">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/25 flex items-center justify-center">
              <ArrowLeftRight size={20} className="text-orange-400" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-base font-display font-semibold text-zinc-100">
                Queue files for instant local conversion
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Files stay on your disk and convert directly in Python — ideal for large videos,
                archives, spreadsheets, documents, and image batches.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleAddFiles}
                disabled={!bridgeAvailable || isPicking}
                className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold disabled:opacity-45 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                <FolderPlus size={14} />
                <span>Select Files from Disk</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-4 border-t border-zinc-900 text-left">
              {SUPPORTED_GROUPS.map((group) => (
                <div
                  key={group.label}
                  className="p-3 rounded-lg bg-[#070709] border border-zinc-900 space-y-1"
                >
                  <div className="text-[11px] font-semibold text-orange-400">{group.label}</div>
                  <div className="text-[11px] font-mono text-zinc-500 leading-relaxed">
                    {group.formats}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-[#0D0D11] border border-zinc-800/90 overflow-hidden">
            {/* Queue Summary Strip */}
            <div className="px-4 py-2.5 bg-[#0A0A0E] border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">
                Queue ({queue.length} {queue.length === 1 ? 'file' : 'files'})
              </span>
              <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                {doneCount > 0 && <span className="text-emerald-400">{doneCount} done</span>}
                {errorCount > 0 && <span className="text-rose-400">{errorCount} failed</span>}
              </div>
            </div>

            {/* File Rows */}
            <ul data-testid="xconvert-queue-list" className="divide-y divide-zinc-900">
              {queue.map((item) => {
                const meta = CATEGORY_META[item.category] || CATEGORY_META.unsupported;
                const CategoryIcon = meta.icon;

                return (
                  <li
                    key={item.id}
                    data-testid="xconvert-queue-row"
                    className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-900/35 transition-colors"
                  >
                    {/* File Info */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide shrink-0 ${meta.className}`}
                        >
                          <CategoryIcon size={11} />
                          <span>{meta.label}</span>
                        </span>
                        <span
                          title={item.path}
                          className="text-sm font-medium text-zinc-100 truncate"
                        >
                          {item.name}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-500 tabular-nums shrink-0">
                          {formatFileSize(item.sizeBytes)}
                        </span>
                      </div>

                      {item.status === 'error' && item.error && (
                        <p className="text-xs text-rose-400 truncate" title={item.error}>
                          {item.error}
                        </p>
                      )}
                      {item.status === 'done' && item.outputPath && (
                        <p
                          className="text-[11px] font-mono text-zinc-500 truncate"
                          title={item.outputPath}
                        >
                          Saved: {item.outputPath}
                        </p>
                      )}
                    </div>

                    {/* Controls + Status */}
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {/* Target Format Dropdown */}
                      {item.compatibleTargets.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono uppercase text-zinc-500">
                            .{item.ext}
                          </span>
                          <span className="text-zinc-600 text-xs">→</span>
                          <select
                            aria-label={`Target format for ${item.name}`}
                            value={item.targetFormat}
                            disabled={isConverting}
                            onChange={(e) => handleTargetChange(item.id, e.target.value)}
                            className="bg-[#070709] border border-zinc-800 hover:border-orange-500/50 rounded-lg px-2.5 py-1 text-xs font-mono uppercase text-orange-300 focus:outline-none focus:border-orange-500 transition-colors"
                          >
                            {item.compatibleTargets.map((fmt) => (
                              <option key={fmt} value={fmt}>
                                {fmt.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-[11px] font-mono text-zinc-500">No targets</span>
                      )}

                      {/* Status Badge */}
                      <div className="min-w-[104px] flex items-center justify-end gap-1.5 text-xs tabular-nums">
                        {item.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <Clock size={12} />
                            <span>Pending</span>
                          </span>
                        )}
                        {item.status === 'converting' && (
                          <span className="inline-flex items-center gap-1 text-orange-400 font-medium">
                            <Loader2 size={12} className="animate-spin" />
                            <span>Converting...</span>
                          </span>
                        )}
                        {item.status === 'done' && (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                            <CheckCircle2 size={12} />
                            <span>
                              Done
                              {typeof item.durationMs === 'number'
                                ? ` · ${formatDuration(item.durationMs)}`
                                : ''}
                            </span>
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                            <AlertCircle size={12} />
                            <span>Error</span>
                          </span>
                        )}
                      </div>

                      {/* Open in Explorer (Done only) */}
                      {item.status === 'done' && item.outputPath && (
                        <button
                          type="button"
                          data-testid="xconvert-open-explorer"
                          onClick={() => handleOpenInExplorer(item.outputPath)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <ExternalLink size={11} />
                          <span>Open in Explorer</span>
                        </button>
                      )}

                      {/* Remove Row */}
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        disabled={isConverting}
                        aria-label={`Remove ${item.name}`}
                        title="Remove from queue"
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800/80 disabled:opacity-35 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
