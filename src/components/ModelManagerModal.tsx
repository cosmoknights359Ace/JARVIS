import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  Trash2,
  RefreshCw,
  Check,
  AlertTriangle,
  Loader2,
  ExternalLink,
  HardDrive,
  Cpu,
  Terminal
} from 'lucide-react';
import { OllamaInstalledModel, SystemStats } from '../types';
import {
  RECOMMENDED_OLLAMA_MODELS,
  formatModelSizeBytes,
  isModelTagInstalled,
  isValidOllamaModelTag
} from '../utils/modelManager';
import {
  formatHardwareReadout,
  getModelFitBadge,
  ModelFitBadge
} from '../utils/hardwareTier';
import { deleteOllamaModel, pullOllamaModelStream } from '../services/jarvisBrain';
import { sfx } from '../services/soundEffects';

interface ModelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: SystemStats;
  ollamaHost: string;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onRefreshOllama: () => Promise<void> | void;
}

type ManagerTab = 'installed' | 'recommended';

interface PullProgressState {
  model: string;
  status: string;
  percent: number | null;
  completed?: number;
  total?: number;
  inProgress: boolean;
  succeeded: boolean;
  error: string | null;
}

function getFitBadgeTone(badge: ModelFitBadge): string {
  if (badge === 'Optimal') return 'text-emerald-400';
  if (badge === 'Heavy') return 'text-amber-400';
  return 'text-rose-400';
}

function formatPullStatusLabel(status: string, percent: number | null): string {
  const clean = (status || 'Pulling layers...').trim();
  const normalized =
    clean.toLowerCase().startsWith('pulling ') && clean.length > 22
      ? 'Pulling layers...'
      : clean.charAt(0).toUpperCase() + clean.slice(1);
  if (percent !== null && !normalized.toLowerCase().includes('success')) {
    return `${normalized} ${percent}%`;
  }
  return normalized;
}

export const ModelManagerModal: React.FC<ModelManagerModalProps> = ({
  isOpen,
  onClose,
  stats,
  ollamaHost,
  selectedModel,
  onSelectModel,
  onRefreshOllama
}) => {
  const [activeTab, setActiveTab] = useState<ManagerTab>('recommended');
  const [customModelTag, setCustomModelTag] = useState('');
  const [customInputError, setCustomInputError] = useState<string | null>(null);
  const [pullState, setPullState] = useState<PullProgressState | null>(null);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const pullAbortRef = useRef<AbortController | null>(null);
  const wasOpenRef = useRef(false);

  // Pick the most useful initial tab when opening the modal
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setActiveTab(stats.installedModels.length > 0 ? 'installed' : 'recommended');
      setConfirmDeleteModel(null);
      setDeleteError(null);
      setCustomInputError(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, stats.installedModels.length]);

  // Abort active pull on unmount or modal close
  useEffect(() => {
    if (!isOpen && pullAbortRef.current) {
      pullAbortRef.current.abort();
      pullAbortRef.current = null;
    }
    return () => {
      if (pullAbortRef.current) {
        pullAbortRef.current.abort();
        pullAbortRef.current = null;
      }
    };
  }, [isOpen]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const installedList: OllamaInstalledModel[] =
    stats.installedModelDetails.length > 0
      ? stats.installedModelDetails
      : stats.installedModels.map((name) => ({ name, size: null }));

  const handleRefresh = async () => {
    sfx.playClick();
    setIsRefreshing(true);
    try {
      await onRefreshOllama();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCancelPull = () => {
    sfx.playClick();
    if (pullAbortRef.current) {
      pullAbortRef.current.abort();
      pullAbortRef.current = null;
    }
    setPullState((prev) =>
      prev
        ? {
            ...prev,
            inProgress: false,
            succeeded: false,
            status: 'Download cancelled',
            error: null
          }
        : null
    );
  };

  const startPullModel = async (rawTag: string) => {
    const tag = rawTag.trim();
    if (!isValidOllamaModelTag(tag)) {
      setCustomInputError('Enter a valid Ollama model tag (e.g. qwen2.5:3b or gemma4).');
      return;
    }
    if (pullState?.inProgress) return;

    sfx.playClick();
    setCustomInputError(null);
    setDeleteError(null);

    const controller = new AbortController();
    pullAbortRef.current = controller;

    setPullState({
      model: tag,
      status: 'Connecting to Ollama...',
      percent: 0,
      inProgress: true,
      succeeded: false,
      error: null
    });

    try {
      let lastError: string | null = null;
      let sawDone = false;

      for await (const evt of pullOllamaModelStream(tag, ollamaHost, controller.signal)) {
        if (controller.signal.aborted) return;

        if (evt.error) {
          lastError = evt.error;
          setPullState({
            model: tag,
            status: 'Download failed',
            percent: null,
            inProgress: false,
            succeeded: false,
            error: evt.error
          });
          return;
        }

        if (evt.done) {
          sawDone = true;
        }

        setPullState((prev) => ({
          model: tag,
          status: evt.status || prev?.status || 'Pulling layers...',
          percent: evt.percent !== null ? evt.percent : prev?.percent ?? null,
          completed: evt.completed ?? prev?.completed,
          total: evt.total ?? prev?.total,
          inProgress: !evt.done,
          succeeded: evt.done,
          error: null
        }));
      }

      if (controller.signal.aborted) return;

      if (!lastError) {
        setPullState((prev) => ({
          model: tag,
          status: sawDone ? 'Installed successfully' : prev?.status || 'Installed successfully',
          percent: 100,
          completed: prev?.total ?? prev?.completed,
          total: prev?.total,
          inProgress: false,
          succeeded: true,
          error: null
        }));
        sfx.playCommandConfirm();
        await onRefreshOllama();
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setPullState({
        model: tag,
        status: 'Download failed',
        percent: null,
        inProgress: false,
        succeeded: false,
        error: err?.message || 'Unable to pull model from local Ollama.'
      });
    } finally {
      if (pullAbortRef.current === controller) {
        pullAbortRef.current = null;
      }
    }
  };

  const handleCustomPullSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customModelTag.trim();
    if (!cleaned) {
      setCustomInputError('Type an Ollama model tag first (e.g. gemma4).');
      return;
    }
    void startPullModel(cleaned);
  };

  const handleConfirmDelete = async (modelName: string) => {
    sfx.playClick();
    setDeletingModel(modelName);
    setDeleteError(null);

    const res = await deleteOllamaModel(modelName, ollamaHost);
    setDeletingModel(null);
    setConfirmDeleteModel(null);

    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }

    sfx.playCommandConfirm();
    if (selectedModel.toLowerCase() === modelName.toLowerCase()) {
      onSelectModel('auto');
    }
    await onRefreshOllama();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-manager-title"
    >
      <div
        className="w-full max-w-3xl max-h-[86vh] flex flex-col bg-[#0F0F13] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-zinc-800/80">
          <div className="min-w-0">
            <h2
              id="model-manager-title"
              className="text-lg font-display font-semibold text-zinc-100"
            >
              Ollama Model Manager
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5 flex flex-wrap items-center gap-1.5">
              {stats.hardware ? (
                <>
                  <span className="font-mono text-zinc-300 tabular-nums">
                    {formatHardwareReadout(stats.hardware, { compact: true })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Recommended up to{' '}
                    <span className="font-mono text-orange-400 tabular-nums">
                      {stats.hardware.recommendedMaxParamsB}B
                    </span>
                  </span>
                </>
              ) : (
                <span>
                  Install, inspect, and remove local Ollama models without opening a terminal.
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
              title="Refresh installed Ollama models"
            >
              <RefreshCw
                size={12}
                className={`text-orange-400 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
              aria-label="Close Model Manager"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Strip & Connection Summary */}
        <div className="px-6 py-3 bg-[#070709] border-b border-zinc-900 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Model manager views"
            className="flex items-center gap-1 p-1 bg-zinc-900 rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'installed'}
              onClick={() => {
                sfx.playClick();
                setActiveTab('installed');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'installed'
                  ? 'bg-orange-500 text-black font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Installed Models</span>
              <span className="font-mono tabular-nums opacity-80">
                ({installedList.length})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recommended'}
              onClick={() => {
                sfx.playClick();
                setActiveTab('recommended');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                activeTab === 'recommended'
                  ? 'bg-orange-500 text-black font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Recommended Models</span>
              <span className="font-mono tabular-nums opacity-80">
                ({RECOMMENDED_OLLAMA_MODELS.length})
              </span>
            </button>
          </div>

          <div className="text-xs text-zinc-400 flex items-center gap-2 font-mono">
            <span
              className={stats.ollamaReachable ? 'text-emerald-400' : 'text-amber-400'}
            >
              {stats.ollamaReachable ? 'Ollama Connected' : 'Ollama Offline'}
            </span>
            <span aria-hidden="true" className="text-zinc-700">·</span>
            <span className="text-zinc-500 truncate max-w-[180px]" title={ollamaHost}>
              {ollamaHost}
            </span>
          </div>
        </div>

        {/* Non-Blocking Offline Notice inside Modal */}
        {!stats.ollamaReachable && (
          <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-start gap-2 text-amber-200">
              <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <span>
                Local AI Engine (Ollama) is not running. Launch Ollama to install or delete local models.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-medium transition-colors whitespace-nowrap"
              >
                Retry Connection
              </button>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <span>Get Ollama</span>
                <ExternalLink size={11} />
              </a>
            </div>
          </div>
        )}

        {/* Active Pull Progress Bar Strip */}
        {pullState && (
          <div
            data-testid="model-pull-progress"
            className={`px-6 py-3.5 border-b ${
              pullState.error
                ? 'bg-rose-500/10 border-rose-500/30'
                : pullState.succeeded
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-orange-500/10 border-orange-500/30'
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {pullState.inProgress ? (
                  <Loader2 size={14} className="text-orange-400 animate-spin shrink-0" />
                ) : pullState.error ? (
                  <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                ) : (
                  <Check size={14} className="text-emerald-400 shrink-0" />
                )}
                <code className="font-mono font-semibold text-zinc-100 truncate">
                  {pullState.model}
                </code>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span
                  className={`truncate ${
                    pullState.error
                      ? 'text-rose-300'
                      : pullState.succeeded
                      ? 'text-emerald-300'
                      : 'text-orange-300'
                  }`}
                >
                  {pullState.error
                    ? pullState.error
                    : formatPullStatusLabel(pullState.status, pullState.percent)}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {pullState.total && pullState.total > 0 && pullState.inProgress && (
                  <span className="font-mono text-[11px] text-zinc-400 tabular-nums hidden sm:inline">
                    {formatModelSizeBytes(pullState.completed)} /{' '}
                    {formatModelSizeBytes(pullState.total)}
                  </span>
                )}
                {pullState.inProgress ? (
                  <button
                    type="button"
                    onClick={handleCancelPull}
                    className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPullState(null)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>

            {pullState.inProgress && (
              <div className="mt-2.5 h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-[width] duration-200 ease-out"
                  style={{
                    width: `${
                      pullState.percent !== null ? Math.max(4, pullState.percent) : 18
                    }%`
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Delete Error Feedback */}
        {deleteError && (
          <div className="px-6 py-2.5 bg-rose-500/10 border-b border-rose-500/30 flex items-center justify-between gap-3 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
              <span>{deleteError}</span>
            </div>
            <button
              type="button"
              onClick={() => setDeleteError(null)}
              className="text-rose-300 hover:text-rose-100 text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Panel Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'installed' ? (
            installedList.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-3 border border-zinc-800/80 rounded-xl bg-[#070709]">
                <HardDrive size={24} className="text-zinc-600 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-200">
                    No installed Ollama models found
                  </p>
                  <p className="text-xs text-zinc-500 max-w-md mx-auto">
                    Install a hardware-matched model from the Recommended tab or pull any Ollama model tag below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('recommended')}
                  className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold transition-colors"
                >
                  Browse Recommended Models
                </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-900 border border-zinc-800/90 rounded-xl bg-[#070709]">
                {installedList.map((item) => {
                  const fitBadge = getModelFitBadge(item.name, stats.hardware);
                  const isActive =
                    selectedModel.toLowerCase() === item.name.toLowerCase() ||
                    (selectedModel === 'auto' &&
                      stats.resolvedModel.toLowerCase() === item.name.toLowerCase());
                  const isConfirming = confirmDeleteModel === item.name;
                  const isDeletingThis = deletingModel === item.name;

                  return (
                    <div
                      key={item.name}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-2.5 hover:bg-zinc-900/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-sm font-semibold text-zinc-100 truncate">
                            {item.name}
                          </code>
                          {isActive && (
                            <span className="text-[11px] font-mono text-orange-400">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 font-mono tabular-nums">
                          <span>{formatModelSizeBytes(item.size)}</span>
                          {item.parameterSize && (
                            <>
                              <span aria-hidden="true" className="text-zinc-700">·</span>
                              <span>{item.parameterSize}</span>
                            </>
                          )}
                          {item.quantizationLevel && (
                            <>
                              <span aria-hidden="true" className="text-zinc-700">·</span>
                              <span>{item.quantizationLevel}</span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-zinc-700">·</span>
                          <span className={getFitBadgeTone(fitBadge)}>{fitBadge}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isConfirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleConfirmDelete(item.name)}
                              disabled={isDeletingThis}
                              aria-label={`Confirm delete ${item.name}`}
                              className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-black text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                            >
                              {isDeletingThis ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                              <span>Confirm Delete</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteModel(null)}
                              disabled={isDeletingThis}
                              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {selectedModel.toLowerCase() !== item.name.toLowerCase() && (
                              <button
                                type="button"
                                onClick={() => {
                                  sfx.playClick();
                                  onSelectModel(item.name);
                                }}
                                aria-label={`Select ${item.name}`}
                                className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition-colors whitespace-nowrap"
                              >
                                Use Model
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                sfx.playClick();
                                setConfirmDeleteModel(item.name);
                              }}
                              disabled={Boolean(deletingModel)}
                              aria-label={`Delete ${item.name}`}
                              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-rose-500/15 border border-zinc-800 hover:border-rose-500/40 text-xs font-medium text-zinc-400 hover:text-rose-300 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                            >
                              <Trash2 size={12} />
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
                <span className="flex items-center gap-1.5">
                  <Cpu size={13} className="text-orange-500" />
                  <span>Hardware fit badges automatically match your detected GPU &amp; VRAM tier.</span>
                </span>
              </div>

              <div className="divide-y divide-zinc-900 border border-zinc-800/90 rounded-xl bg-[#070709]">
                {RECOMMENDED_OLLAMA_MODELS.map((spec) => {
                  const fitBadge = getModelFitBadge(spec.tag, stats.hardware);
                  const installed = isModelTagInstalled(spec.tag, stats.installedModels);
                  const isPullingThis =
                    pullState?.inProgress &&
                    pullState.model.toLowerCase() === spec.tag.toLowerCase();

                  return (
                    <div
                      key={spec.tag}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-2.5 hover:bg-zinc-900/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-100">
                            {spec.title}
                          </span>
                          <span aria-hidden="true" className="text-zinc-700">·</span>
                          <code className="font-mono text-xs text-orange-400">
                            {spec.tag}
                          </code>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                          <span>{spec.role}</span>
                          <span aria-hidden="true" className="text-zinc-700">·</span>
                          <span className="font-mono tabular-nums">{spec.approxSize}</span>
                          <span aria-hidden="true" className="text-zinc-700">·</span>
                          <span className={`font-mono font-medium ${getFitBadgeTone(fitBadge)}`}>
                            {fitBadge}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          {spec.summary}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {installed ? (
                          <>
                            <span className="text-xs font-mono text-emerald-400 inline-flex items-center gap-1 px-2">
                              <Check size={13} />
                              <span>Installed</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                sfx.playClick();
                                onSelectModel(spec.tag);
                                onClose();
                              }}
                              aria-label={`Use ${spec.tag}`}
                              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition-colors whitespace-nowrap"
                            >
                              Use
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void startPullModel(spec.tag)}
                            disabled={Boolean(pullState?.inProgress)}
                            aria-label={`Install ${spec.tag}`}
                            className="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-45 text-black text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                          >
                            {isPullingThis ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                <span className="font-mono tabular-nums">
                                  {pullState?.percent !== null
                                    ? `${pullState.percent}%`
                                    : 'Pulling...'}
                                </span>
                              </>
                            ) : (
                              <>
                                <Download size={13} />
                                <span>Install</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Custom Model Pull Footer */}
        <div className="px-6 py-4 bg-[#070709] border-t border-zinc-900 space-y-2">
          <form
            onSubmit={handleCustomPullSubmit}
            className="flex flex-col sm:flex-row sm:items-center gap-2.5"
          >
            <label
              htmlFor="custom-ollama-model-input"
              className="text-xs font-medium text-zinc-300 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            >
              <Terminal size={13} className="text-orange-500" />
              <span>Custom Model</span>
            </label>
            <input
              id="custom-ollama-model-input"
              type="text"
              value={customModelTag}
              onChange={(e) => {
                setCustomModelTag(e.target.value);
                if (customInputError) setCustomInputError(null);
              }}
              placeholder="Type any Ollama tag (e.g. gemma4, mistral:7b, phi3:mini)"
              autoComplete="off"
              className="flex-1 bg-[#0F0F13] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              disabled={Boolean(pullState?.inProgress) || !customModelTag.trim()}
              className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-orange-500 hover:text-black disabled:opacity-45 border border-zinc-800 hover:border-orange-500 text-zinc-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download size={13} />
              <span>Pull Model</span>
            </button>
          </form>
          {customInputError && (
            <p className="text-xs text-rose-400">{customInputError}</p>
          )}
        </div>
      </div>
    </div>
  );
};
