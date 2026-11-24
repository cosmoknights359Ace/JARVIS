import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Presentation,
  Upload,
  Sparkles,
  Download,
  RefreshCw,
  Check,
  AlertTriangle,
  Search,
  Database,
  ShieldCheck,
  X
} from 'lucide-react';
import {
  JarvisSettings,
  MemoryStore,
  SystemStats,
  XfillDocument,
  XfillFileType,
  XfillOptions,
  XfillSlot
} from '../types';
import { sfx } from '../services/soundEffects';
import {
  buildStudioModelOptions,
  DEFAULT_STUDIO_MODEL,
  formatModelOptionLabel
} from '../utils/modelOptions';
import { saveBlobFile } from '../utils/fileDownload';

interface XfillViewProps {
  settings: JarvisSettings;
  onUpdateSettings: (newSettings: JarvisSettings) => void;
  memory: MemoryStore;
  onUpdateMemory: (newMem: MemoryStore) => void;
  stats: SystemStats;
}

type SlotFilter = 'all' | 'filled' | 'review' | 'unfilled';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileIcon(type: XfillFileType) {
  if (type === 'xlsx') return <FileSpreadsheet size={18} className="text-emerald-400" />;
  if (type === 'pptx') return <Presentation size={18} className="text-amber-400" />;
  return <FileText size={18} className="text-orange-400" />;
}

export const XfillView: React.FC<XfillViewProps> = ({
  settings,
  onUpdateSettings,
  memory,
  onUpdateMemory,
  stats
}) => {
  const [doc, setDoc] = useState<XfillDocument | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [solvingSlotId, setSolvingSlotId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [lastRunMeta, setLastRunMeta] = useState<{
    provider: string;
    model: string;
    elapsedMs: number;
  } | null>(null);

  const [filter, setFilter] = useState<SlotFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedMemSlotId, setSavedMemSlotId] = useState<string | null>(null);

  const [options, setOptions] = useState<XfillOptions>({
    contextNotes: '',
    strictGrounding: false,
    answerStyle: 'concise',
    customInstructions: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const preferredModel = (settings.xfillModel || DEFAULT_STUDIO_MODEL).trim();
  const modelOptions = buildStudioModelOptions({
    activeModel: preferredModel,
    installedModels: stats.installedModels,
    generalModel: settings.generalModel,
    codingModel: settings.codingModel
  });

  const inspectFile = async (file: File) => {
    setErrorMsg(null);
    setStatusNotice(null);
    setLastRunMeta(null);

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.docx') && !lower.endsWith('.xlsx') && !lower.endsWith('.pptx')) {
      setErrorMsg('Unsupported file type. Upload a .docx, .xlsx, or .pptx Office document.');
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg('File is larger than 12 MB. Please upload a smaller document.');
      return;
    }

    setIsInspecting(true);
    sfx.playClick();

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('Could not read file from disk.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/jarvis/xfill/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileBase64: base64 })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Document inspection failed.');
      }

      setDoc(data);
      setFilter('all');
      sfx.playCommandConfirm();
      setStatusNotice(
        data.slots.length > 0
          ? `Detected ${data.slots.length} fillable ${data.slots.length === 1 ? 'field' : 'fields'}. Review context notes or run Auto-Fill.`
          : 'Document loaded, but no blank fields, Q&A rows, or {{placeholders}} were detected.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to parse document.');
    } finally {
      setIsInspecting(false);
    }
  };

  const loadSample = async (type: XfillFileType) => {
    setErrorMsg(null);
    setStatusNotice(null);
    setLastRunMeta(null);
    setIsInspecting(true);
    sfx.playClick();

    try {
      const res = await fetch(`/api/jarvis/xfill/sample?type=${type}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load sample template.');
      setDoc(data);
      setFilter('all');
      sfx.playCommandConfirm();
      setStatusNotice(
        `Loaded sample ${type.toUpperCase()} template with ${data.slots.length} detected fields. Click Auto-Fill All Fields to test.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load sample.');
    } finally {
      setIsInspecting(false);
    }
  };

  const handleSolve = async (slotIds?: string[]) => {
    if (!doc || doc.slots.length === 0 || isSolving) return;
    setErrorMsg(null);
    setStatusNotice(null);

    const isSingle = Array.isArray(slotIds) && slotIds.length === 1;
    if (isSingle) setSolvingSlotId(slotIds[0]);
    setIsSolving(true);
    sfx.playClick();

    try {
      const res = await fetch('/api/jarvis/xfill/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: doc.docId,
          slotIds,
          memory,
          contextNotes: options.contextNotes,
          strictGrounding: options.strictGrounding,
          answerStyle: options.answerStyle,
          customInstructions: options.customInstructions,
          modelName: preferredModel,
          ollamaHost: settings.ollamaHost || 'http://localhost:11434',
          keepAliveMinutes: settings.keepAliveMinutes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Auto-fill solver failed.');
      }

      const resultMap = new Map<string, any>();
      for (const item of data.results || []) {
        resultMap.set(item.id, item);
      }

      setDoc((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          slots: prev.slots.map((slot) => {
            const solved = resultMap.get(slot.id);
            if (!solved) return slot;
            // Preserve user-edited slots on full batch run unless regenerating that single slot
            if (!isSingle && slot.editedByUser && slot.value.trim()) {
              return slot;
            }
            return {
              ...slot,
              value: solved.answer,
              source: solved.source,
              confidence: solved.confidence,
              reasoning: solved.reasoning,
              editedByUser: false
            };
          })
        };
      });

      setLastRunMeta({
        provider: data.provider === 'ollama' ? 'Local Ollama' : 'Gemini Cloud',
        model: data.model,
        elapsedMs: data.elapsedMs
      });

      const needsInputCount = (data.results || []).filter(
        (r: any) => r.confidence === 'needs_input'
      ).length;
      sfx.playCommandConfirm();
      setStatusNotice(
        isSingle
          ? 'Regenerated field with grounded answer.'
          : needsInputCount > 0
          ? `Filled fields in ${data.elapsedMs}ms. ${needsInputCount} private/unknown ${needsInputCount === 1 ? 'field needs' : 'fields need'} your input.`
          : `All ${data.results?.length || 0} fields filled cleanly in ${data.elapsedMs}ms.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to generate grounded answers.');
    } finally {
      setIsSolving(false);
      setSolvingSlotId(null);
    }
  };

  const handleSlotEdit = (slotId: string, nextValue: string) => {
    setDoc((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        slots: prev.slots.map((s) => {
          if (s.id !== slotId) return s;
          const isBlank = !nextValue.trim() || /\[needs input\]/i.test(nextValue);
          return {
            ...s,
            value: nextValue,
            editedByUser: true,
            source: isBlank ? 'missing' : 'user',
            confidence: isBlank ? 'needs_input' : 'high'
          };
        })
      };
    });
  };

  const handleSaveSlotToMemory = (slot: XfillSlot) => {
    if (!slot.value.trim() || /\[needs input\]/i.test(slot.value)) return;
    const rawKey = slot.prompt
      .replace(/\(from:.*\)$/i, '')
      .replace(/\[.*\]$/, '')
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .slice(0, 32);
    if (!rawKey) return;
    onUpdateMemory({ ...memory, [rawKey]: slot.value.trim() });
    setSavedMemSlotId(slot.id);
    sfx.playCommandConfirm();
    setTimeout(() => setSavedMemSlotId(null), 1800);
  };

  const handleExport = async () => {
    if (!doc || isExporting) return;
    setErrorMsg(null);
    setIsExporting(true);
    sfx.playClick();

    try {
      const answers: Record<string, string> = {};
      for (const s of doc.slots) {
        if (s.value.trim() && !/^\[needs input\]$/i.test(s.value.trim())) {
          answers[s.id] = s.value.trim();
        }
      }

      const res = await fetch('/api/jarvis/xfill/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.docId, answers })
      });

      if (!res.ok) {
        let msg = 'Export failed.';
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const dotIdx = doc.fileName.lastIndexOf('.');
      const base = dotIdx > 0 ? doc.fileName.slice(0, dotIdx) : doc.fileName;
      const downloadName = `${base}_filled.${doc.fileType}`;

      const outcome = await saveBlobFile(blob, downloadName);
      if (outcome.cancelled) {
        setStatusNotice('Export cancelled.');
        return;
      }

      sfx.playCommandConfirm();
      setStatusNotice(
        outcome.path
          ? `Saved to "${outcome.path}" with original formatting preserved.`
          : `Exported "${downloadName}" with original formatting preserved.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not export updated document.');
    } finally {
      setIsExporting(false);
    }
  };

  const slots = doc?.slots || [];
  const filledCount = slots.filter(
    (s) => s.value.trim() && s.confidence !== 'needs_input' && !/^\[needs input\]$/i.test(s.value.trim())
  ).length;
  const reviewCount = slots.filter(
    (s) => s.confidence === 'needs_input' || s.confidence === 'medium' || /\[needs input\]/i.test(s.value)
  ).length;
  const unfilledCount = slots.filter((s) => !s.value.trim()).length;

  const filteredSlots = slots.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      s.prompt.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      s.value.toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (filter === 'filled') {
      return Boolean(s.value.trim()) && s.confidence !== 'needs_input';
    }
    if (filter === 'review') {
      return s.confidence === 'needs_input' || s.confidence === 'medium' || /\[needs input\]/i.test(s.value);
    }
    if (filter === 'unfilled') {
      return !s.value.trim();
    }
    return true;
  });

  const renderSourceMeta = (slot: XfillSlot) => {
    const sourceMap: Record<XfillSlot['source'], { label: string; cls: string }> = {
      memory: { label: 'Memory Bank', cls: 'text-emerald-400' },
      context: { label: 'Context Notes', cls: 'text-sky-400' },
      knowledge: { label: 'Model Knowledge', cls: 'text-orange-400' },
      user: { label: 'Edited by You', cls: 'text-emerald-400' },
      missing: { label: 'Needs Input', cls: 'text-rose-400' },
      pending: { label: 'Awaiting Fill', cls: 'text-zinc-500' }
    };
    const confMap: Record<XfillSlot['confidence'], { label: string; cls: string }> = {
      high: { label: 'High Confidence', cls: 'text-emerald-400' },
      medium: { label: 'Verify', cls: 'text-amber-400' },
      needs_input: { label: 'Missing Private Data', cls: 'text-rose-400' },
      pending: { label: 'Not Solved', cls: 'text-zinc-500' }
    };
    const src = sourceMap[slot.source];
    const conf = confMap[slot.confidence];

    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-zinc-500">
        <span className="text-zinc-300 font-medium">{slot.location}</span>
        <span aria-hidden="true">·</span>
        <span className="capitalize">{slot.kind.replace('_', ' ')}</span>
        <span aria-hidden="true">·</span>
        <span className={src.cls}>{src.label}</span>
        <span aria-hidden="true">·</span>
        <span className={conf.cls}>{conf.label}</span>
      </div>
    );
  };

  return (
    <section className="flex-1 overflow-y-auto p-5 md:p-7 bg-[#070709]" id="view-XFILL">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 sm:p-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-mono text-orange-400 font-semibold">Xfill Engine</span>
              <span aria-hidden="true">·</span>
              <span>DOCX, XLSX & PPTX</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {stats.activeProvider === 'ollama'
                  ? `Local Ollama (${preferredModel})`
                  : stats.activeProvider === 'gemini'
                  ? 'Gemini Cloud Fallback'
                  : 'Engine Offline'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-zinc-100 tracking-tight">
              Document Q&A & Form Auto-Fill
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
              Upload any Word, Excel, or PowerPoint file. Xfill extracts fillable fields deterministically, solves them with strict anti-hallucination grounding, lets you review every answer, and exports your original formatted file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <label className="flex items-center gap-1.5 bg-[#070709] border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-400">
              <span className="text-[11px] font-medium text-zinc-500">Model</span>
              <select
                aria-label="Xfill model"
                value={preferredModel}
                onChange={(e) => {
                  sfx.playClick();
                  onUpdateSettings({ ...settings, xfillModel: e.target.value });
                }}
                className="bg-transparent text-zinc-100 font-mono text-xs focus:outline-none cursor-pointer"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m} className="bg-[#111115] text-zinc-100">
                    {formatModelOptionLabel(m)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => handleSolve()}
              disabled={!doc || slots.length === 0 || isSolving}
              className="px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Sparkles size={14} />
              <span>{isSolving && !solvingSlotId ? 'Solving Fields...' : 'Auto-Fill All Fields'}</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!doc || filledCount === 0 || isExporting}
              className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-100 border border-zinc-800 hover:border-orange-500/40 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Download size={14} className="text-orange-400" />
              <span>{isExporting ? 'Exporting...' : 'Download Updated File'}</span>
            </button>
          </div>
        </div>

        {/* Inline Status / Error Feedback */}
        {errorMsg && (
          <div
            role="alert"
            className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/35 text-xs text-rose-200 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={15} className="text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss error"
              className="text-rose-300 hover:text-white p-1"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {statusNotice && !errorMsg && (
          <div className="px-4 py-3 rounded-xl bg-[#111115] border border-orange-500/30 text-xs text-zinc-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-orange-400 shrink-0" />
              <span>{statusNotice}</span>
            </div>
            {lastRunMeta && (
              <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                {lastRunMeta.provider} · {lastRunMeta.model} · {lastRunMeta.elapsedMs}ms
              </span>
            )}
          </div>
        )}

        {/* Main 2-Column Workstation */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Upload, Samples, Grounding & Controls */}
          <div className="lg:col-span-4 space-y-5">
            {/* Upload Dropzone */}
            <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-display font-semibold text-zinc-100">
                  1. Source Document
                </h2>
                <span className="text-[11px] font-mono text-zinc-500">Max 12 MB</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.xlsx,.pptx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) inspectFile(f);
                  e.target.value = '';
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) inspectFile(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`cursor-pointer rounded-xl border border-dashed p-5 text-center transition-colors space-y-2 ${
                  isDragging
                    ? 'border-orange-500 bg-orange-500/10'
                    : 'border-zinc-700 hover:border-orange-500/60 bg-[#070709]'
                }`}
              >
                <Upload size={22} className="mx-auto text-orange-400" />
                <div className="text-xs font-medium text-zinc-200">
                  {isInspecting ? 'Inspecting structure...' : 'Drop .docx, .xlsx, or .pptx here'}
                </div>
                <div className="text-[11px] text-zinc-500">
                  or click to browse your computer
                </div>
              </div>

              {doc && (
                <div className="p-3 rounded-xl bg-[#070709] border border-zinc-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {getFileIcon(doc.fileType)}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-100 truncate">
                        {doc.fileName}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                        {doc.fileType.toUpperCase()} · {formatBytes(doc.sizeBytes)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDoc(null);
                      setLastRunMeta(null);
                      setStatusNotice(null);
                    }}
                    title="Unload document"
                    aria-label="Unload document"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Built-In Test Templates */}
              <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                <div className="text-[11px] font-medium text-zinc-400">
                  Or try a built-in sample file
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { type: 'docx', label: 'Word .docx' },
                      { type: 'xlsx', label: 'Excel .xlsx' },
                      { type: 'pptx', label: 'Slide .pptx' }
                    ] as const
                  ).map((item) => (
                    <button
                      type="button"
                      key={item.type}
                      disabled={isInspecting}
                      onClick={() => loadSample(item.type)}
                      className="px-2.5 py-2 rounded-lg bg-[#070709] hover:bg-zinc-900 border border-zinc-800 hover:border-orange-500/40 text-[11px] font-mono text-zinc-300 hover:text-orange-400 transition-colors whitespace-nowrap"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Grounding & Precision Controls */}
            <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-display font-semibold text-zinc-100">
                  2. Grounding & Accuracy
                </h2>
                <span className="text-[11px] font-mono text-orange-400 tabular-nums">
                  {Object.keys(memory).length} memory facts
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Optional Context Notes
                </label>
                <textarea
                  rows={4}
                  value={options.contextNotes}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, contextNotes: e.target.value }))
                  }
                  placeholder="Paste facts, project brief, personal details, or study notes here. Xfill prioritizes Memory + Context Notes before general knowledge."
                  className="w-full bg-[#070709] border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500 resize-y leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-zinc-300">Answer Style</span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-[#070709] border border-zinc-800 rounded-xl">
                  {(
                    [
                      { id: 'concise', label: 'Concise' },
                      { id: 'detailed', label: 'Detailed' },
                      { id: 'bullets', label: 'Bullets' }
                    ] as const
                  ).map((mode) => (
                    <button
                      type="button"
                      key={mode.id}
                      onClick={() =>
                        setOptions((prev) => ({ ...prev, answerStyle: mode.id }))
                      }
                      className={`py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        options.answerStyle === mode.id
                          ? 'bg-orange-500 text-black font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#070709] border border-zinc-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    Strict Context-Only Mode
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    Only answer from Memory & Context Notes; mark all else as [NEEDS INPUT]
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setOptions((prev) => ({
                      ...prev,
                      strictGrounding: !prev.strictGrounding
                    }))
                  }
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                    options.strictGrounding
                      ? 'bg-orange-500 text-black'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {options.strictGrounding ? 'On' : 'Off'}
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Custom Instructions (optional)
                </label>
                <input
                  type="text"
                  value={options.customInstructions}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, customInstructions: e.target.value }))
                  }
                  placeholder="e.g. Keep answers under 15 words, formal tone"
                  className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Detected Fields, Review Editor & Export */}
          <div className="lg:col-span-8 bg-[#111115] border border-zinc-800/90 rounded-2xl flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="px-5 py-4 border-b border-zinc-800/90 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-display font-semibold text-zinc-100">
                    3. Review & Edit Detected Fields
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {doc
                      ? doc.summary
                      : 'Upload a file or select a sample template on the left to extract fields.'}
                  </p>
                </div>

                {doc && (
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-zinc-400">
                    <span className="text-emerald-400">{filledCount} ready</span>
                    <span aria-hidden="true">·</span>
                    <span className={reviewCount > 0 ? 'text-amber-400' : 'text-zinc-500'}>
                      {reviewCount} review
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{slots.length} total</span>
                  </div>
                )}
              </div>

              {doc && slots.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-1 p-1 bg-[#070709] border border-zinc-800 rounded-lg overflow-x-auto">
                    {(
                      [
                        { id: 'all', label: `All (${slots.length})` },
                        { id: 'filled', label: `Filled (${filledCount})` },
                        { id: 'review', label: `Needs Review (${reviewCount})` },
                        { id: 'unfilled', label: `Unfilled (${unfilledCount})` }
                      ] as const
                    ).map((tab) => (
                      <button
                        type="button"
                        key={tab.id}
                        onClick={() => setFilter(tab.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          filter === tab.id
                            ? 'bg-orange-500 text-black font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-56 shrink-0">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-2.5 text-zinc-500 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter fields..."
                      className="w-full bg-[#070709] border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Field List */}
            {!doc ? (
              <div className="py-20 px-6 text-center space-y-3">
                <Sparkles size={28} className="mx-auto text-orange-500/70" />
                <div className="text-sm font-display font-semibold text-zinc-200">
                  Ready to inspect your document
                </div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                  Xfill supports Word questionnaires (<code className="font-mono text-zinc-300">.docx</code>), Excel Q&A or tracker tables (<code className="font-mono text-zinc-300">.xlsx</code>), and PowerPoint decks (<code className="font-mono text-zinc-300">.pptx</code>). Load a sample template on the left to see zero-hallucination auto-fill in action.
                </p>
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="py-16 px-6 text-center text-xs text-zinc-500">
                {slots.length === 0
                  ? 'No blank fields, questions, or {{placeholders}} were detected in this document.'
                  : 'No fields match your current filter.'}
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/80 max-h-[560px] overflow-y-auto">
                {filteredSlots.map((slot) => {
                  const needsInput =
                    slot.confidence === 'needs_input' || /\[needs input\]/i.test(slot.value);
                  const isRowSolving = solvingSlotId === slot.id;

                  return (
                    <div
                      key={slot.id}
                      className={`p-4 sm:p-5 space-y-2.5 transition-colors ${
                        needsInput ? 'bg-rose-500/[0.04]' : 'hover:bg-zinc-900/30'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          {renderSourceMeta(slot)}
                          <div className="text-sm font-medium text-zinc-100 leading-snug">
                            {slot.prompt}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSolve([slot.id])}
                            disabled={isSolving}
                            title="Regenerate this field"
                            className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-orange-400 disabled:opacity-40 flex items-center gap-1 transition-colors whitespace-nowrap"
                          >
                            <RefreshCw
                              size={11}
                              className={isRowSolving ? 'animate-spin text-orange-400' : ''}
                            />
                            <span>{isRowSolving ? 'Solving...' : 'Regenerate'}</span>
                          </button>

                          {slot.value.trim() && !needsInput && (
                            <button
                              type="button"
                              onClick={() => handleSaveSlotToMemory(slot)}
                              title="Save answer to persistent Memory Bank"
                              className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-emerald-400 flex items-center gap-1 transition-colors whitespace-nowrap"
                            >
                              {savedMemSlotId === slot.id ? (
                                <>
                                  <Check size={11} className="text-emerald-400" />
                                  <span className="text-emerald-400">Saved</span>
                                </>
                              ) : (
                                <>
                                  <Database size={11} />
                                  <span>Remember</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        rows={slot.value.length > 110 ? 3 : 2}
                        value={slot.value}
                        onChange={(e) => handleSlotEdit(slot.id, e.target.value)}
                        placeholder="Click Auto-Fill All Fields or type your answer directly..."
                        className={`w-full rounded-xl px-3.5 py-2.5 text-xs leading-relaxed bg-[#070709] border focus:outline-none transition-colors resize-y ${
                          needsInput
                            ? 'border-rose-500/50 text-rose-200 focus:border-orange-500'
                            : 'border-zinc-800 text-zinc-100 focus:border-orange-500'
                        }`}
                      />

                      {slot.reasoning && (
                        <div className="text-[11px] text-zinc-500">
                          Note: {slot.reasoning}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Export Action Bar */}
            {doc && slots.length > 0 && (
              <div className="px-5 py-3.5 bg-[#0A0A0D] border-t border-zinc-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-zinc-400 tabular-nums">
                  {filledCount} of {slots.length} fields ready to write into{' '}
                  <span className="font-mono text-zinc-200">{doc.fileName}</span>
                  {reviewCount > 0 && (
                    <span className="text-amber-400 ml-2">
                      ({reviewCount} flagged for review)
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={filledCount === 0 || isExporting}
                  className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-black font-semibold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Download size={14} />
                  <span>
                    {isExporting
                      ? 'Building File...'
                      : `Export Filled .${doc.fileType.toUpperCase()}`}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
