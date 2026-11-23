import React, { useState, useEffect, useCallback } from 'react';
import {
  Presentation,
  Sparkles,
  Download,
  RefreshCw,
  Image as ImageIcon,
  ShieldCheck,
  ShieldOff,
  Search,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  X,
  Check,
  AlertTriangle,
  Globe,
  FileText,
  Wand2
} from 'lucide-react';
import {
  JarvisSettings,
  MemoryStore,
  SlideAudience,
  SlideDeck,
  SlideImageAsset,
  SlideItem,
  SlideLayoutType,
  SlideThemeId,
  SystemStats
} from '../types';
import { sfx } from '../services/soundEffects';
import { buildStudioModelOptions, DEFAULT_STUDIO_MODEL } from '../utils/modelOptions';

interface SlidesViewProps {
  settings: JarvisSettings;
  onUpdateSettings: (newSettings: JarvisSettings) => void;
  memory: MemoryStore;
  stats: SystemStats;
}

interface ThemeVisualSpec {
  id: SlideThemeId;
  name: string;
  tagline: string;
  bg: string;
  surface: string;
  border: string;
  accent: string;
  text: string;
  muted: string;
  isDark: boolean;
}

const THEME_SPECS: Record<SlideThemeId, ThemeVisualSpec> = {
  'obsidian-orange': {
    id: 'obsidian-orange',
    name: 'Obsidian & Orange',
    tagline: 'Signature dark J.A.R.V.I.S deck',
    bg: '#09090D',
    surface: '#14141B',
    border: '#27272F',
    accent: '#F97316',
    text: '#F4F4F6',
    muted: '#A1A1AA',
    isDark: true
  },
  'editorial-ivory': {
    id: 'editorial-ivory',
    name: 'Editorial Ivory',
    tagline: 'Crisp warm paper & burnt orange',
    bg: '#F8F7F4',
    surface: '#FFFFFF',
    border: '#E2E0D8',
    accent: '#C2410C',
    text: '#18181B',
    muted: '#52525B',
    isDark: false
  },
  'slate-executive': {
    id: 'slate-executive',
    name: 'Slate Executive',
    tagline: 'Boardroom navy & sky highlight',
    bg: '#0F172A',
    surface: '#1E293B',
    border: '#334155',
    accent: '#38BDF8',
    text: '#F8FAFC',
    muted: '#94A3B8',
    isDark: true
  },
  'emerald-tech': {
    id: 'emerald-tech',
    name: 'Emerald Tech',
    tagline: 'Deep forest & precision emerald',
    bg: '#07110D',
    surface: '#0F1F18',
    border: '#1F3A2E',
    accent: '#10B981',
    text: '#ECFDF5',
    muted: '#86EFAC',
    isDark: true
  }
};

const LAYOUT_LABELS: Record<SlideLayoutType, string> = {
  title: 'Title Hero',
  split_image: 'Split + Image',
  bullets: 'Bullets',
  two_column: 'Two Column',
  stat_highlight: 'Key Metric'
};

const STARTER_TOPICS = [
  {
    label: 'Local AI with Ollama',
    topic: 'Running Local LLMs on Desktop Hardware with Ollama: Architecture, Privacy & Performance',
    audience: 'technical' as SlideAudience
  },
  {
    label: 'Distributed Systems 101',
    topic: 'Modern Distributed Systems: CAP Theorem, Eventual Consistency, and Resilient APIs',
    audience: 'educational' as SlideAudience
  },
  {
    label: 'Q4 Product Roadmap',
    topic: 'Next-Generation AI Productivity Workstation: Vision, Milestones, and Architecture',
    audience: 'executive' as SlideAudience
  }
];

const DECK_STORAGE_KEY = 'jarvis_slides_draft_v1';

export const SlidesView: React.FC<SlidesViewProps> = ({
  settings,
  onUpdateSettings,
  memory,
  stats
}) => {
  // Creation Brief State
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState<number>(8);
  const [audience, setAudience] = useState<SlideAudience>('executive');
  const [themeId, setThemeId] = useState<SlideThemeId>('obsidian-orange');
  const [contextNotes, setContextNotes] = useState('');
  const [includeMemory, setIncludeMemory] = useState(true);

  // Active Deck State (persisted across tab switches)
  const [deck, setDeck] = useState<SlideDeck | null>(() => {
    try {
      const saved = localStorage.getItem(DECK_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
          return parsed as SlideDeck;
        }
      }
    } catch {
      // ignore corrupt storage
    }
    return null;
  });

  const [activeSlideIdx, setActiveSlideIdx] = useState<number>(0);
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'images'>('edit');

  // Consent State (strictly OFF by default every session)
  const [webImageConsent, setWebImageConsent] = useState<boolean>(false);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [pendingConsentAction, setPendingConsentAction] = useState<
    null | { type: 'search_active' } | { type: 'batch_fill' }
  >(null);

  // Image Picker State
  const [imageQueryInput, setImageQueryInput] = useState<string>('');
  const [imageResults, setImageResults] = useState<SlideImageAsset[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState<boolean>(false);
  const [isBatchFillingImages, setIsBatchFillingImages] = useState<boolean>(false);

  // Async Process States
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRegeneratingSlide, setIsRegeneratingSlide] = useState<boolean>(false);
  const [regenInstruction, setRegenInstruction] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Sync deck draft to localStorage
  useEffect(() => {
    if (deck) {
      try {
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
      } catch {
        // ignore storage quota issues
      }
    } else {
      localStorage.removeItem(DECK_STORAGE_KEY);
    }
  }, [deck]);

  const activeSlide = deck?.slides[activeSlideIdx] || null;
  const activeTheme = THEME_SPECS[deck?.themeId || themeId] || THEME_SPECS['obsidian-orange'];

  // Keep image query input aligned when switching slides
  useEffect(() => {
    if (activeSlide) {
      setImageQueryInput(activeSlide.imageQuery || activeSlide.title);
      setImageResults([]);
    }
  }, [activeSlide?.id]);

  // Escape closes consent modal
  useEffect(() => {
    if (!showConsentModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowConsentModal(false);
        setPendingConsentAction(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConsentModal]);

  const resolvedModelName = (settings.slidesModel || DEFAULT_STUDIO_MODEL).trim();
  const modelOptions = buildStudioModelOptions({
    activeModel: resolvedModelName,
    installedModels: stats.installedModels,
    generalModel: settings.generalModel,
    codingModel: settings.codingModel
  });

  const updateActiveSlide = (patch: Partial<SlideItem>) => {
    if (!deck || !activeSlide) return;
    setDeck((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, idx) =>
        idx === activeSlideIdx ? { ...s, ...patch } : s
      );
      return { ...prev, updatedAt: new Date().toISOString(), slides };
    });
  };

  const handleThemeChange = (nextTheme: SlideThemeId) => {
    sfx.playClick();
    setThemeId(nextTheme);
    if (deck) {
      setDeck({ ...deck, themeId: nextTheme, updatedAt: new Date().toISOString() });
    }
  };

  const handleGenerateDeck = async () => {
    if (!topic.trim() || isGenerating) return;
    sfx.playClick();
    setErrorMsg(null);
    setNoticeMsg(null);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/jarvis/slides/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          slideCount,
          audience,
          themeId,
          contextNotes,
          includeMemory,
          memory,
          modelName: resolvedModelName,
          ollamaHost: settings.ollamaHost,
          keepAliveMinutes: settings.keepAliveMinutes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not generate presentation.');
      }

      const newDeck = data.deck as SlideDeck;
      setDeck(newDeck);
      setActiveSlideIdx(0);
      setInspectorTab('edit');
      setImageResults([]);
      sfx.playCommandConfirm();
      setNoticeMsg(
        `Generated ${newDeck.slides.length} slides via ${
          newDeck.provider === 'ollama' ? `Local Ollama (${newDeck.model})` : `Gemini Cloud (${newDeck.model})`
        } in ${(data.elapsedMs / 1000).toFixed(1)}s.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to generate slides.');
    } finally {
      setIsGenerating(false);
    }
  };

  const runImageSearch = useCallback(
    async (query: string, consentOverride = false) => {
      const approved = consentOverride || webImageConsent;
      if (!approved) {
        setPendingConsentAction({ type: 'search_active' });
        setShowConsentModal(true);
        return;
      }
      const q = query.trim();
      if (!q) return;

      setErrorMsg(null);
      setIsSearchingImages(true);
      try {
        const res = await fetch('/api/jarvis/slides/image-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q,
            consentGranted: true,
            limit: 6
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Web image search failed.');
        }
        setImageResults(Array.isArray(data.images) ? data.images : []);
        if (!data.images || data.images.length === 0) {
          setNoticeMsg(`No public images matched "${q}". Try simpler visual keywords.`);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Image search encountered an error.');
      } finally {
        setIsSearchingImages(false);
      }
    },
    [webImageConsent]
  );

  const runBatchFillImages = useCallback(
    async (consentOverride = false) => {
      if (!deck) return;
      const approved = consentOverride || webImageConsent;
      if (!approved) {
        setPendingConsentAction({ type: 'batch_fill' });
        setShowConsentModal(true);
        return;
      }

      setErrorMsg(null);
      setNoticeMsg(null);
      setIsBatchFillingImages(true);

      try {
        let attachedCount = 0;
        const updatedSlides = [...deck.slides];

        for (let i = 0; i < updatedSlides.length; i++) {
          const s = updatedSlides[i];
          if (s.image) continue;
          if (s.layout === 'two_column' || s.layout === 'stat_highlight') continue;

          const q = (s.imageQuery || s.title).trim();
          if (!q) continue;

          try {
            const res = await fetch('/api/jarvis/slides/image-search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: q, consentGranted: true, limit: 3 })
            });
            if (!res.ok) continue;
            const data = await res.json();
            const first = Array.isArray(data.images) ? data.images[0] : null;
            if (first) {
              updatedSlides[i] = { ...s, image: first };
              attachedCount++;
            }
          } catch {
            // continue to remaining slides
          }
        }

        setDeck((prev) =>
          prev ? { ...prev, updatedAt: new Date().toISOString(), slides: updatedSlides } : prev
        );
        sfx.playCommandConfirm();
        setNoticeMsg(
          attachedCount > 0
            ? `Attached ${attachedCount} web ${attachedCount === 1 ? 'image' : 'images'} across visual slides. You can swap or remove any image before exporting.`
            : 'All visual slides already have images or no matches were returned.'
        );
      } finally {
        setIsBatchFillingImages(false);
      }
    },
    [deck, webImageConsent]
  );

  const handleApproveConsent = () => {
    sfx.playCommandConfirm();
    setWebImageConsent(true);
    setShowConsentModal(false);
    const pending = pendingConsentAction;
    setPendingConsentAction(null);

    if (pending?.type === 'search_active' && activeSlide) {
      setInspectorTab('images');
      runImageSearch(imageQueryInput || activeSlide.imageQuery || activeSlide.title, true);
    } else if (pending?.type === 'batch_fill') {
      runBatchFillImages(true);
    } else {
      setNoticeMsg('Web image search approved for this session. Only slide keywords are queried.');
    }
  };

  const handleRevokeConsent = () => {
    sfx.playClick();
    setWebImageConsent(false);
    setImageResults([]);
    setNoticeMsg('Web image access revoked. Slides studio is back in offline mode.');
  };

  const handleRegenerateActiveSlide = async () => {
    if (!deck || !activeSlide || isRegeneratingSlide) return;
    sfx.playClick();
    setErrorMsg(null);
    setIsRegeneratingSlide(true);

    try {
      const res = await fetch('/api/jarvis/slides/regenerate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckTitle: deck.title,
          topic: deck.topic,
          audience: deck.audience,
          slide: activeSlide,
          slideIndex: activeSlideIdx,
          totalSlides: deck.slides.length,
          instruction: regenInstruction,
          contextNotes,
          modelName: resolvedModelName,
          ollamaHost: settings.ollamaHost,
          keepAliveMinutes: settings.keepAliveMinutes
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not regenerate slide.');
      }

      setDeck((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.map((s, idx) =>
          idx === activeSlideIdx ? (data.slide as SlideItem) : s
        );
        return { ...prev, updatedAt: new Date().toISOString(), slides };
      });
      setRegenInstruction('');
      sfx.playCommandConfirm();
      setNoticeMsg(`Refined slide ${activeSlideIdx + 1} via ${data.provider === 'ollama' ? 'Local Ollama' : 'Gemini Cloud'}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to regenerate slide.');
    } finally {
      setIsRegeneratingSlide(false);
    }
  };

  const handleAddSlide = () => {
    if (!deck) return;
    sfx.playClick();
    const newSlide: SlideItem = {
      id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      layout: 'split_image',
      kicker: `Section ${String(deck.slides.length).padStart(2, '0')}`,
      title: 'New Slide Title',
      bullets: ['Key supporting point one', 'Key supporting point two', 'Key supporting point three'],
      speakerNotes: 'Introduce this slide and elaborate on the primary takeaways.',
      imageQuery: deck.topic.split(/\s+/).slice(0, 3).join(' ') || 'modern technology',
      image: null
    };
    const nextSlides = [...deck.slides];
    nextSlides.splice(activeSlideIdx + 1, 0, newSlide);
    setDeck({ ...deck, updatedAt: new Date().toISOString(), slides: nextSlides });
    setActiveSlideIdx(activeSlideIdx + 1);
  };

  const handleDuplicateSlide = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deck) return;
    sfx.playClick();
    const orig = deck.slides[idx];
    const copy: SlideItem = {
      ...orig,
      id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      title: `${orig.title} (Copy)`,
      bullets: [...orig.bullets],
      secondaryBullets: orig.secondaryBullets ? [...orig.secondaryBullets] : undefined,
      highlightStat: orig.highlightStat ? { ...orig.highlightStat } : undefined
    };
    const nextSlides = [...deck.slides];
    nextSlides.splice(idx + 1, 0, copy);
    setDeck({ ...deck, updatedAt: new Date().toISOString(), slides: nextSlides });
    setActiveSlideIdx(idx + 1);
  };

  const handleDeleteSlide = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deck || deck.slides.length <= 1) return;
    sfx.playClick();
    const nextSlides = deck.slides.filter((_, i) => i !== idx);
    setDeck({ ...deck, updatedAt: new Date().toISOString(), slides: nextSlides });
    setActiveSlideIdx((prev) => Math.max(0, Math.min(prev, nextSlides.length - 1)));
  };

  const handleMoveSlide = (idx: number, dir: -1 | 1, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deck) return;
    const target = idx + dir;
    if (target < 0 || target >= deck.slides.length) return;
    sfx.playClick();
    const nextSlides = [...deck.slides];
    const [moved] = nextSlides.splice(idx, 1);
    nextSlides.splice(target, 0, moved);
    setDeck({ ...deck, updatedAt: new Date().toISOString(), slides: nextSlides });
    if (activeSlideIdx === idx) setActiveSlideIdx(target);
    else if (activeSlideIdx === target) setActiveSlideIdx(idx);
  };

  const handleExportPptx = async () => {
    if (!deck || isExporting) return;
    sfx.playClick();
    setErrorMsg(null);
    setIsExporting(true);

    try {
      const res = await fetch('/api/jarvis/slides/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to compile PowerPoint file.');
      }

      const embeddedCount = Number(res.headers.get('X-Embedded-Images') || '0');
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename="([^"]+)"/i);
      const fileName = nameMatch ? nameMatch[1] : 'jarvis_presentation.pptx';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      sfx.playCommandConfirm();
      setNoticeMsg(
        `Exported ${fileName} (${deck.slides.length} slides${
          embeddedCount > 0 ? ` · ${embeddedCount} offline embedded ${embeddedCount === 1 ? 'image' : 'images'}` : ''
        } · speaker notes included).`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectImageForSlide = (asset: SlideImageAsset) => {
    if (!activeSlide) return;
    sfx.playCommandConfirm();
    const nextLayout: SlideLayoutType =
      activeSlide.layout === 'bullets' ? 'split_image' : activeSlide.layout;
    updateActiveSlide({ image: asset, layout: nextLayout });
  };

  const memoryCount = Object.keys(memory).length;
  const attachedImagesCount = deck ? deck.slides.filter((s) => Boolean(s.image)).length : 0;

  // ============================================================================
  // Render Live Proportional 16:9 Slide Canvas
  // ============================================================================
  const renderSlidePreviewCanvas = (slide: SlideItem, index: number, total: number) => {
    const t = activeTheme;
    const slideNumStr = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;

    return (
      <div
        className="relative w-full aspect-video rounded-xl overflow-hidden border shadow-2xl select-none flex flex-col justify-between transition-colors duration-200"
        style={{
          backgroundColor: t.bg,
          borderColor: t.border,
          color: t.text
        }}
      >
        {/* Top Accent Strip */}
        <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: t.accent }} />

        {/* Slide Body */}
        <div className="flex-1 px-7 py-5 sm:px-9 sm:py-6 flex flex-col min-h-0 overflow-hidden">
          {slide.layout === 'title' ? (
            <div className="flex-1 flex items-center gap-6 min-h-0">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="w-12 h-1 rounded-full" style={{ backgroundColor: t.accent }} />
                {slide.kicker && (
                  <div
                    className="text-[11px] font-semibold tracking-widest uppercase truncate"
                    style={{ color: t.accent }}
                  >
                    {slide.kicker}
                  </div>
                )}
                <h2 className="text-xl sm:text-2xl md:text-3xl font-display font-bold leading-tight text-balance">
                  {slide.title}
                </h2>
                {(slide.subtitle || slide.bullets[0]) && (
                  <p className="text-xs sm:text-sm leading-relaxed line-clamp-3" style={{ color: t.muted }}>
                    {slide.subtitle || slide.bullets[0]}
                  </p>
                )}
              </div>

              {slide.image && (
                <div
                  className="w-[34%] h-[82%] shrink-0 rounded-lg border p-2 flex flex-col items-center justify-between overflow-hidden"
                  style={{ backgroundColor: t.surface, borderColor: t.border }}
                >
                  <img
                    src={slide.image.thumbUrl}
                    alt={slide.image.caption}
                    className="w-full flex-1 min-h-0 object-contain rounded"
                  />
                  <div
                    className="text-[9px] truncate w-full text-center pt-1"
                    style={{ color: t.muted }}
                  >
                    {slide.image.credit}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Content Slide Header */}
              <div className="pb-3 mb-3 border-b shrink-0" style={{ borderColor: t.border }}>
                {slide.kicker && (
                  <div
                    className="text-[11px] font-semibold truncate mb-0.5"
                    style={{ color: t.accent }}
                  >
                    {slide.kicker}
                  </div>
                )}
                <h2 className="text-lg sm:text-xl md:text-2xl font-display font-bold leading-snug truncate">
                  {slide.title}
                </h2>
              </div>

              {/* Layout Content Area */}
              {slide.layout === 'split_image' ? (
                <div className="flex-1 grid grid-cols-12 gap-5 min-h-0 items-center">
                  <ul className="col-span-7 space-y-2.5 overflow-y-auto max-h-full pr-1">
                    {slide.bullets.map((b, bi) => (
                      <li key={bi} className="flex items-start gap-2.5 text-xs sm:text-sm leading-snug">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: t.accent }}
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <div
                    className="col-span-5 h-full max-h-56 rounded-lg border p-2 flex flex-col items-center justify-center overflow-hidden"
                    style={{ backgroundColor: t.surface, borderColor: t.border }}
                  >
                    {slide.image ? (
                      <>
                        <img
                          src={slide.image.thumbUrl}
                          alt={slide.image.caption}
                          className="w-full flex-1 min-h-0 object-contain rounded"
                        />
                        <div
                          className="text-[9px] truncate w-full text-center pt-1"
                          style={{ color: t.muted }}
                        >
                          {slide.image.credit}
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setInspectorTab('images');
                          if (!webImageConsent) {
                            setPendingConsentAction({ type: 'search_active' });
                            setShowConsentModal(true);
                          } else {
                            runImageSearch(imageQueryInput || slide.imageQuery || slide.title);
                          }
                        }}
                        className="flex flex-col items-center justify-center gap-2 text-center px-3 py-4 opacity-80 hover:opacity-100 transition-opacity"
                        style={{ color: t.muted }}
                      >
                        <ImageIcon size={22} style={{ color: t.accent }} />
                        <span className="text-[11px] font-medium">
                          {webImageConsent ? 'Search & pick visual' : 'Approve web image search'}
                        </span>
                        <span className="text-[10px] font-mono opacity-75 truncate max-w-[150px]">
                          {slide.imageQuery}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ) : slide.layout === 'two_column' ? (
                <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                  <div
                    className="rounded-lg border p-3.5 overflow-y-auto"
                    style={{ backgroundColor: t.surface, borderColor: t.border }}
                  >
                    <ul className="space-y-2">
                      {slide.bullets.map((b, bi) => (
                        <li key={bi} className="flex items-start gap-2 text-xs sm:text-sm leading-snug">
                          <span
                            className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                            style={{ backgroundColor: t.accent }}
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    className="rounded-lg border p-3.5 overflow-y-auto"
                    style={{ backgroundColor: t.surface, borderColor: t.border }}
                  >
                    <ul className="space-y-2">
                      {(slide.secondaryBullets && slide.secondaryBullets.length > 0
                        ? slide.secondaryBullets
                        : ['Add second-column points in the editor']
                      ).map((b, bi) => (
                        <li key={bi} className="flex items-start gap-2 text-xs sm:text-sm leading-snug">
                          <span
                            className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                            style={{ backgroundColor: t.accent }}
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : slide.layout === 'stat_highlight' ? (
                <div className="flex-1 grid grid-cols-12 gap-5 min-h-0 items-center">
                  <div
                    className="col-span-5 h-full max-h-52 rounded-xl border p-4 flex flex-col items-center justify-center text-center"
                    style={{ backgroundColor: t.surface, borderColor: t.accent }}
                  >
                    <div
                      className="text-3xl sm:text-4xl font-display font-bold font-mono tabular-nums"
                      style={{ color: t.accent }}
                    >
                      {slide.highlightStat?.value || '100%'}
                    </div>
                    <div
                      className="text-xs mt-2 leading-snug line-clamp-3"
                      style={{ color: t.muted }}
                    >
                      {slide.highlightStat?.label || slide.kicker}
                    </div>
                  </div>
                  <ul className="col-span-7 space-y-2.5 overflow-y-auto max-h-full">
                    {slide.bullets.map((b, bi) => (
                      <li key={bi} className="flex items-start gap-2.5 text-xs sm:text-sm leading-snug">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: t.accent }}
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex-1 flex gap-5 min-h-0 items-start">
                  <ul className="flex-1 space-y-2.5 overflow-y-auto max-h-full">
                    {slide.bullets.map((b, bi) => (
                      <li key={bi} className="flex items-start gap-2.5 text-xs sm:text-sm leading-snug">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: t.accent }}
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {slide.image && (
                    <div
                      className="w-[36%] h-full max-h-52 shrink-0 rounded-lg border p-2 flex flex-col items-center justify-center overflow-hidden"
                      style={{ backgroundColor: t.surface, borderColor: t.border }}
                    >
                      <img
                        src={slide.image.thumbUrl}
                        alt={slide.image.caption}
                        className="w-full flex-1 min-h-0 object-contain rounded"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Quiet Slide Footer */}
        <div
          className="px-7 sm:px-9 py-2.5 flex items-center justify-between text-[10px] shrink-0"
          style={{ color: t.muted }}
        >
          <span className="truncate max-w-[70%]">{deck?.title || 'J.A.R.V.I.S Presentation'}</span>
          <span className="font-mono font-semibold tabular-nums">{slideNumStr}</span>
        </div>
      </div>
    );
  };

  return (
    <section
      id="view-SLIDES"
      className="flex-1 flex flex-col min-h-0 bg-[#070709] text-zinc-100 overflow-hidden"
    >
      {/* Top Studio Bar */}
      <div className="px-5 py-3.5 border-b border-zinc-900 bg-[#0A0A0D] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Presentation size={17} className="text-orange-500 shrink-0" />
            <h1 className="text-base font-display font-bold text-zinc-100 truncate">
              {deck ? deck.title : 'J.A.R.V.I.S Xslide Studio'}
            </h1>
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 flex flex-wrap items-center gap-2 tabular-nums">
            <span>
              {stats.ollamaReachable
                ? `Local Ollama · ${resolvedModelName}`
                : 'Gemini Cloud Fallback · gemini-4-hydrogen'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {deck
                ? `${deck.slides.length} slides · ${attachedImagesCount} ${
                    attachedImagesCount === 1 ? 'image' : 'images'
                  }`
                : '16:9 PowerPoint (.pptx) Builder'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={webImageConsent ? 'text-emerald-400' : 'text-amber-400'}>
              {webImageConsent ? 'Web Images Approved' : 'Offline Mode (Web Locked)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400">
            <span className="text-[11px] font-medium text-zinc-500">Model</span>
            <select
              aria-label="Xslide model"
              value={resolvedModelName}
              onChange={(e) => {
                sfx.playClick();
                onUpdateSettings({ ...settings, slidesModel: e.target.value });
              }}
              className="bg-transparent text-zinc-100 font-mono text-xs focus:outline-none cursor-pointer"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m} className="bg-[#111115] text-zinc-100">
                  {m}
                </option>
              ))}
            </select>
          </label>

          {/* Consent Controls */}
          {!webImageConsent ? (
            <button
              type="button"
              onClick={() => {
                sfx.playClick();
                setPendingConsentAction(null);
                setShowConsentModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Globe size={13} className="text-orange-400" />
              <span>Allow Web Images</span>
            </button>
          ) : (
            <>
              {deck && (
                <button
                  type="button"
                  disabled={isBatchFillingImages}
                  onClick={() => runBatchFillImages(true)}
                  className="px-3 py-1.5 rounded-lg bg-orange-500/12 hover:bg-orange-500/20 border border-orange-500/40 text-xs font-medium text-orange-300 flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <ImageIcon size={13} className={isBatchFillingImages ? 'animate-pulse' : ''} />
                  <span>{isBatchFillingImages ? 'Fetching Images...' : 'Auto-Fetch Slide Images'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleRevokeConsent}
                title="Revoke session web image access"
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <ShieldOff size={13} />
                <span>Revoke Web</span>
              </button>
            </>
          )}

          {deck && (
            <>
              <button
                type="button"
                onClick={() => {
                  sfx.playClick();
                  setTopic(deck.topic);
                  setDeck(null);
                  setImageResults([]);
                  setNoticeMsg(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors whitespace-nowrap"
              >
                New Deck
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={handleExportPptx}
                className="px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                <Download size={14} />
                <span>{isExporting ? 'Compiling .pptx...' : 'Export .pptx'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status / Error Notifications */}
      {(errorMsg || noticeMsg) && (
        <div
          className={`px-5 py-2.5 border-b text-xs flex items-center justify-between gap-3 shrink-0 ${
            errorMsg
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {errorMsg ? (
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
            ) : (
              <Check size={14} className="text-emerald-400 shrink-0" />
            )}
            <span className="truncate">{errorMsg || noticeMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setNoticeMsg(null);
            }}
            aria-label="Dismiss notification"
            className="text-zinc-400 hover:text-zinc-100 shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ZERO-STATE: Deck Brief & Theme Configuration                         */}
      {/* ==================================================================== */}
      {!deck ? (
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {isGenerating ? (
              <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-8 space-y-6">
                <div className="flex items-center gap-3">
                  <RefreshCw size={18} className="text-orange-500 animate-spin" />
                  <div>
                    <h2 className="text-base font-display font-semibold text-zinc-100">
                      Drafting {slideCount}-Slide Blueprint...
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Generating structured slide layouts, concise points, speaker notes, and image queries via{' '}
                      {stats.ollamaReachable ? `Local Ollama (${resolvedModelName})` : 'Gemini Cloud'}.
                    </p>
                  </div>
                </div>
                <div className="aspect-video max-w-2xl rounded-xl border border-zinc-800 bg-[#0A0A0E] p-8 flex flex-col justify-between animate-pulse">
                  <div className="space-y-3">
                    <div className="h-3 w-32 bg-zinc-800 rounded" />
                    <div className="h-7 w-3/4 bg-zinc-800 rounded" />
                  </div>
                  <div className="space-y-2.5">
                    <div className="h-3.5 w-full bg-zinc-900 rounded" />
                    <div className="h-3.5 w-5/6 bg-zinc-900 rounded" />
                    <div className="h-3.5 w-2/3 bg-zinc-900 rounded" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Presentation Brief */}
                <div className="lg:col-span-7 bg-[#111115] border border-zinc-800/90 rounded-2xl p-6 space-y-5">
                  <div>
                    <h2 className="text-xl font-display font-bold text-zinc-100 text-balance">
                      Build a PowerPoint Deck with Local AI
                    </h2>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Enter your topic and optional grounding notes. J.A.R.V.I.S drafts a structured outline with speaker notes, lets you attach user-approved web images, and exports a clean 16:9 <code className="font-mono text-zinc-300">.pptx</code> file.
                    </p>
                  </div>

                  {/* Topic Input */}
                  <div className="space-y-2">
                    <label htmlFor="slides-topic" className="block text-xs font-medium text-zinc-300">
                      Presentation Topic
                    </label>
                    <textarea
                      id="slides-topic"
                      rows={3}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. Local-First AI Engineering: How Ollama and Deterministic Parsers Eliminate Hallucinations"
                      className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/70 resize-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span className="text-[11px] text-zinc-500">Quick starters:</span>
                      {STARTER_TOPICS.map((st) => (
                        <button
                          key={st.label}
                          type="button"
                          onClick={() => {
                            sfx.playClick();
                            setTopic(st.topic);
                            setAudience(st.audience);
                          }}
                          className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-orange-300 transition-colors"
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slide Count & Audience */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="block text-xs font-medium text-zinc-300">Slide Count</span>
                      <div className="grid grid-cols-4 gap-1.5 p-1 rounded-lg bg-[#070709] border border-zinc-800/90">
                        {[5, 8, 10, 12].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              sfx.playClick();
                              setSlideCount(n);
                            }}
                            className={`py-1.5 text-xs font-mono font-medium rounded-md transition-colors tabular-nums ${
                              slideCount === n
                                ? 'bg-orange-500 text-black font-semibold'
                                : 'text-zinc-400 hover:text-zinc-100'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="block text-xs font-medium text-zinc-300">Audience Tone</span>
                      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#070709] border border-zinc-800/90">
                        {(['executive', 'technical', 'educational', 'pitch'] as SlideAudience[]).map(
                          (aud) => (
                            <button
                              key={aud}
                              type="button"
                              onClick={() => {
                                sfx.playClick();
                                setAudience(aud);
                              }}
                              className={`py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                                audience === aud
                                  ? 'bg-zinc-800 text-orange-400'
                                  : 'text-zinc-400 hover:text-zinc-100'
                              }`}
                            >
                              {aud}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Optional Grounding Notes */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="slides-notes" className="text-xs font-medium text-zinc-300">
                        Grounding Facts / Context Notes (Optional)
                      </label>
                      <span className="text-[11px] text-zinc-500">Prevents fabricated metrics</span>
                    </div>
                    <textarea
                      id="slides-notes"
                      rows={3}
                      value={contextNotes}
                      onChange={(e) => setContextNotes(e.target.value)}
                      placeholder="Paste key bullet points, product specs, dates, or verified figures you want reflected accurately in the slides..."
                      className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/70 resize-none"
                    />
                  </div>

                  {/* Memory Toggle + Submit */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-zinc-800/80">
                    <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeMemory}
                        onChange={(e) => setIncludeMemory(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900 accent-orange-500"
                      />
                      <span>
                        Ground with Memory Bank ({memoryCount} {memoryCount === 1 ? 'fact' : 'facts'})
                      </span>
                    </label>

                    <button
                      type="button"
                      disabled={!topic.trim() || isGenerating}
                      onClick={handleGenerateDeck}
                      className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-45 whitespace-nowrap"
                    >
                      <Sparkles size={14} />
                      <span>Generate {slideCount}-Slide Deck</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Visual Theme Presets + Consent Privacy Card */}
                <div className="lg:col-span-5 space-y-5">
                  <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 space-y-3.5">
                    <div>
                      <h3 className="text-sm font-display font-semibold text-zinc-100">
                        Visual Theme Preset
                      </h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Switch themes anytime in the studio before exporting.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {(Object.values(THEME_SPECS) as ThemeVisualSpec[]).map((t) => {
                        const selected = themeId === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleThemeChange(t.id)}
                            className={`text-left rounded-xl p-2.5 border transition-colors ${
                              selected
                                ? 'border-orange-500 bg-orange-500/8'
                                : 'border-zinc-800 bg-[#0A0A0D] hover:border-zinc-700'
                            }`}
                          >
                            {/* Miniature 16:9 Swatch */}
                            <div
                              className="aspect-video rounded-md border overflow-hidden mb-2 flex flex-col justify-between p-2"
                              style={{ backgroundColor: t.bg, borderColor: t.border }}
                            >
                              <div className="h-1 w-8 rounded-full" style={{ backgroundColor: t.accent }} />
                              <div className="space-y-1">
                                <div className="h-1.5 w-3/4 rounded-sm" style={{ backgroundColor: t.text, opacity: 0.85 }} />
                                <div className="h-1 w-1/2 rounded-sm" style={{ backgroundColor: t.muted, opacity: 0.6 }} />
                              </div>
                            </div>
                            <div className="text-xs font-semibold text-zinc-100 truncate">
                              {t.name}
                            </div>
                            <div className="text-[11px] text-zinc-500 truncate">{t.tagline}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Consent-First Web Image Notice */}
                  <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0">
                        {webImageConsent ? (
                          <ShieldCheck size={16} className="text-emerald-400" />
                        ) : (
                          <Globe size={16} className="text-orange-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-display font-semibold text-zinc-100">
                          Consent-Gated Web Images
                        </h3>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                          {webImageConsent
                            ? 'Approved for this session. After generating your outline, you can preview and select public Wikimedia & Openverse images per slide.'
                            : 'Web image search is locked by default. You decide if and when J.A.R.V.I.S may query public image libraries for your slides.'}
                        </p>
                      </div>
                    </div>

                    {!webImageConsent ? (
                      <button
                        type="button"
                        onClick={() => {
                          sfx.playClick();
                          setPendingConsentAction(null);
                          setShowConsentModal(true);
                        }}
                        className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-orange-400 transition-colors"
                      >
                        Review & Pre-Approve Web Image Access
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRevokeConsent}
                        className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        Revoke Web Access (Return to Offline)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================================================================== */
        /* ACTIVE WORKSPACE: Slide Strip + Live 16:9 Canvas + Slide Inspector */
        /* ================================================================== */
        <div className="flex-1 flex flex-col xl:flex-row min-h-0 overflow-hidden">
          {/* 1. Left Slide Strip */}
          <aside className="xl:w-60 shrink-0 border-b xl:border-b-0 xl:border-r border-zinc-900 bg-[#0A0A0D] flex flex-col min-h-0">
            <div className="px-3.5 py-2.5 border-b border-zinc-900 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-zinc-400">
                Slides · <span className="font-mono tabular-nums text-zinc-200">{deck.slides.length}</span>
              </span>
              <button
                type="button"
                onClick={handleAddSlide}
                className="px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-medium text-orange-400 flex items-center gap-1 transition-colors"
              >
                <Plus size={12} />
                <span>Add</span>
              </button>
            </div>

            <div className="flex xl:flex-col gap-2 p-2.5 overflow-x-auto xl:overflow-y-auto xl:overflow-x-hidden flex-1">
              {deck.slides.map((s, idx) => {
                const isSelected = idx === activeSlideIdx;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      sfx.playClick();
                      setActiveSlideIdx(idx);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveSlideIdx(idx);
                      }
                    }}
                    className={`group w-44 xl:w-full shrink-0 rounded-xl p-2.5 border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-900/95 border-orange-500/70'
                        : 'bg-[#111115] border-zinc-800/80 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[11px] font-mono font-semibold tabular-nums ${
                          isSelected ? 'text-orange-400' : 'text-zinc-500'
                        }`}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                        {s.image && <ImageIcon size={11} className="text-emerald-400" />}
                        <span>{LAYOUT_LABELS[s.layout]}</span>
                      </div>
                    </div>

                    <div className="text-xs font-medium text-zinc-100 line-clamp-2 leading-snug">
                      {s.title}
                    </div>

                    {/* Slide Reorder / Duplicate / Delete Row */}
                    <div className="mt-2 pt-1.5 border-t border-zinc-800/70 flex items-center justify-end gap-1 opacity-100 xl:opacity-0 xl:group-hover:opacity-100 xl:focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => handleMoveSlide(idx, -1, e)}
                        title="Move slide up"
                        aria-label="Move slide up"
                        className="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === deck.slides.length - 1}
                        onClick={(e) => handleMoveSlide(idx, 1, e)}
                        title="Move slide down"
                        aria-label="Move slide down"
                        className="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDuplicateSlide(idx, e)}
                        title="Duplicate slide"
                        aria-label="Duplicate slide"
                        className="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800"
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={deck.slides.length <= 1}
                        onClick={(e) => handleDeleteSlide(idx, e)}
                        title="Delete slide"
                        aria-label="Delete slide"
                        className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* 2. Center Live 16:9 Canvas + Speaker Notes */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-5">
            {/* Theme Swatch Strip + Prev/Next */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Theme:</span>
                <div className="flex items-center gap-1.5">
                  {(Object.values(THEME_SPECS) as ThemeVisualSpec[]).map((t) => {
                    const active = deck.themeId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleThemeChange(t.id)}
                        title={t.name}
                        className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
                          active
                            ? 'bg-zinc-900 border-orange-500/70 text-zinc-100 font-medium'
                            : 'bg-[#0C0C10] border-zinc-800/90 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-zinc-600 shrink-0"
                          style={{ backgroundColor: t.accent }}
                        />
                        <span className="hidden sm:inline">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={activeSlideIdx === 0}
                  onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                  aria-label="Previous slide"
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 disabled:opacity-35"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="text-xs font-mono text-zinc-400 px-2 tabular-nums">
                  {String(activeSlideIdx + 1).padStart(2, '0')} / {String(deck.slides.length).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  disabled={activeSlideIdx >= deck.slides.length - 1}
                  onClick={() => setActiveSlideIdx((i) => Math.min(deck.slides.length - 1, i + 1))}
                  aria-label="Next slide"
                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 disabled:opacity-35"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            {/* Dominant 16:9 Visual Stage */}
            <div className="w-full max-w-4xl mx-auto">
              {activeSlide && renderSlidePreviewCanvas(activeSlide, activeSlideIdx, deck.slides.length)}
            </div>

            {/* Speaker Notes Panel beneath the Canvas */}
            {activeSlide && (
              <div className="w-full max-w-4xl mx-auto bg-[#111115] border border-zinc-800/90 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="slide-speaker-notes"
                    className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
                  >
                    <FileText size={13} className="text-orange-400" />
                    <span>Presenter Speaker Notes</span>
                  </label>
                  <span className="text-[11px] text-zinc-500">
                    Embedded into PowerPoint Notes pane on export
                  </span>
                </div>
                <textarea
                  id="slide-speaker-notes"
                  rows={3}
                  value={activeSlide.speakerNotes}
                  onChange={(e) => updateActiveSlide({ speakerNotes: e.target.value })}
                  placeholder="Write presenter talking points for this slide..."
                  className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/70 leading-relaxed resize-y"
                />
              </div>
            )}
          </div>

          {/* 3. Right Inspector Panel: Edit Slide / Web Image Picker */}
          {activeSlide && (
            <aside className="w-full xl:w-88 2xl:w-96 shrink-0 border-t xl:border-t-0 xl:border-l border-zinc-900 bg-[#0A0A0D] flex flex-col min-h-0">
              {/* Segmented Tab Bar */}
              <div className="p-3 border-b border-zinc-900 shrink-0">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#070709] border border-zinc-800/90">
                  <button
                    type="button"
                    onClick={() => setInspectorTab('edit')}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                      inspectorTab === 'edit'
                        ? 'bg-zinc-800 text-orange-400 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Slide Content
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectorTab('images')}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                      inspectorTab === 'images'
                        ? 'bg-zinc-800 text-orange-400 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <ImageIcon size={12} />
                    <span>Web Images</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {inspectorTab === 'edit' ? (
                  <>
                    {/* Layout Selector */}
                    <div className="space-y-1.5">
                      <span className="block text-xs font-medium text-zinc-400">Slide Layout</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(Object.keys(LAYOUT_LABELS) as SlideLayoutType[]).map((lay) => (
                          <button
                            key={lay}
                            type="button"
                            onClick={() => updateActiveSlide({ layout: lay })}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs text-left transition-colors ${
                              activeSlide.layout === lay
                                ? 'bg-orange-500/12 border-orange-500/50 text-orange-300 font-medium'
                                : 'bg-[#111115] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {LAYOUT_LABELS[lay]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Kicker & Title */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-zinc-400">Section Kicker</label>
                      <input
                        type="text"
                        value={activeSlide.kicker}
                        onChange={(e) => updateActiveSlide({ kicker: e.target.value })}
                        className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500/70"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-zinc-400">Slide Title</label>
                      <input
                        type="text"
                        value={activeSlide.title}
                        onChange={(e) => updateActiveSlide({ title: e.target.value })}
                        className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-100 focus:outline-none focus:border-orange-500/70"
                      />
                    </div>

                    {activeSlide.layout === 'title' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-zinc-400">Subtitle</label>
                        <textarea
                          rows={2}
                          value={activeSlide.subtitle || ''}
                          onChange={(e) => updateActiveSlide({ subtitle: e.target.value })}
                          className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-orange-500/70 resize-none"
                        />
                      </div>
                    )}

                    {/* Stat Highlight Inputs */}
                    {activeSlide.layout === 'stat_highlight' && (
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-zinc-400">Metric Value</label>
                          <input
                            type="text"
                            value={activeSlide.highlightStat?.value || ''}
                            onChange={(e) =>
                              updateActiveSlide({
                                highlightStat: {
                                  value: e.target.value,
                                  label: activeSlide.highlightStat?.label || ''
                                }
                              })
                            }
                            placeholder="e.g. 99.9%"
                            className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-orange-300 focus:outline-none focus:border-orange-500/70"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-zinc-400">Metric Label</label>
                          <input
                            type="text"
                            value={activeSlide.highlightStat?.label || ''}
                            onChange={(e) =>
                              updateActiveSlide({
                                highlightStat: {
                                  value: activeSlide.highlightStat?.value || '',
                                  label: e.target.value
                                }
                              })
                            }
                            placeholder="e.g. Local uptime"
                            className="w-full bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-orange-500/70"
                          />
                        </div>
                      </div>
                    )}

                    {/* Primary Bullets Editor */}
                    {activeSlide.layout !== 'title' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-zinc-400">
                            {activeSlide.layout === 'two_column' ? 'Left Column Points' : 'Bullet Points'}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveSlide({ bullets: [...activeSlide.bullets, 'New key point'] })
                            }
                            className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1"
                          >
                            <Plus size={11} />
                            <span>Add Bullet</span>
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {activeSlide.bullets.map((b, bi) => (
                            <div key={bi} className="flex items-start gap-1.5">
                              <textarea
                                rows={2}
                                value={b}
                                onChange={(e) => {
                                  const next = [...activeSlide.bullets];
                                  next[bi] = e.target.value;
                                  updateActiveSlide({ bullets: next });
                                }}
                                className="flex-1 bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-orange-500/70 resize-none leading-snug"
                              />
                              <button
                                type="button"
                                disabled={activeSlide.bullets.length <= 1}
                                onClick={() => {
                                  const next = activeSlide.bullets.filter((_, i) => i !== bi);
                                  updateActiveSlide({ bullets: next });
                                }}
                                aria-label="Remove bullet"
                                className="p-1.5 text-zinc-500 hover:text-rose-400 disabled:opacity-30"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Secondary Bullets Editor (Two-Column Layout) */}
                    {activeSlide.layout === 'two_column' && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-zinc-400">Right Column Points</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveSlide({
                                secondaryBullets: [
                                  ...(activeSlide.secondaryBullets || []),
                                  'New comparison point'
                                ]
                              })
                            }
                            className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1"
                          >
                            <Plus size={11} />
                            <span>Add Point</span>
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {(activeSlide.secondaryBullets || []).map((b, bi) => (
                            <div key={bi} className="flex items-start gap-1.5">
                              <textarea
                                rows={2}
                                value={b}
                                onChange={(e) => {
                                  const next = [...(activeSlide.secondaryBullets || [])];
                                  next[bi] = e.target.value;
                                  updateActiveSlide({ secondaryBullets: next });
                                }}
                                className="flex-1 bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-orange-500/70 resize-none leading-snug"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = (activeSlide.secondaryBullets || []).filter(
                                    (_, i) => i !== bi
                                  );
                                  updateActiveSlide({ secondaryBullets: next });
                                }}
                                aria-label="Remove right column bullet"
                                className="p-1.5 text-zinc-500 hover:text-rose-400"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Single-Slide AI Refinement */}
                    <div className="pt-3 border-t border-zinc-900 space-y-2">
                      <span className="block text-xs font-medium text-zinc-300">
                        Refine This Slide with AI
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={regenInstruction}
                          onChange={(e) => setRegenInstruction(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRegenerateActiveSlide();
                            }
                          }}
                          placeholder="e.g. Make bullets shorter & more technical"
                          className="flex-1 min-w-0 bg-[#070709] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/70"
                        />
                        <button
                          type="button"
                          disabled={isRegeneratingSlide}
                          onClick={handleRegenerateActiveSlide}
                          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-orange-400 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                        >
                          <Wand2 size={12} className={isRegeneratingSlide ? 'animate-spin' : ''} />
                          <span>{isRegeneratingSlide ? 'Working' : 'Refine'}</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  /* ======================================================== */
                  /* CONSENT-GATED WEB IMAGE PICKER TAB                       */
                  /* ======================================================== */
                  <div className="space-y-4">
                    {/* Currently Attached Image */}
                    {activeSlide.image && (
                      <div className="p-3 rounded-xl bg-[#111115] border border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-emerald-400">
                            Attached to Slide {activeSlideIdx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateActiveSlide({ image: null })}
                            className="text-[11px] text-zinc-400 hover:text-rose-400 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                        <img
                          src={activeSlide.image.thumbUrl}
                          alt={activeSlide.image.caption}
                          className="w-full h-32 object-cover rounded-lg border border-zinc-800 bg-black"
                        />
                        <div className="text-[11px] text-zinc-400 truncate">
                          {activeSlide.image.credit}
                        </div>
                      </div>
                    )}

                    {!webImageConsent ? (
                      <div className="p-4 rounded-xl bg-[#111115] border border-zinc-800 space-y-3 text-center">
                        <Globe size={24} className="text-orange-400 mx-auto" />
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-zinc-100">
                            Web Image Search Locked
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            J.A.R.V.I.S requires your explicit approval before querying Wikimedia Commons or Openverse for slide visuals.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            sfx.playClick();
                            setPendingConsentAction({ type: 'search_active' });
                            setShowConsentModal(true);
                          }}
                          className="w-full py-2 px-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold transition-colors"
                        >
                          Approve Web Image Search
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-400">
                            Visual Search Keywords
                          </label>
                          <div className="flex items-center gap-1.5">
                            <div className="relative flex-1 min-w-0">
                              <Search
                                size={13}
                                className="absolute left-2.5 top-2 text-zinc-500 pointer-events-none"
                              />
                              <input
                                type="text"
                                value={imageQueryInput}
                                onChange={(e) => {
                                  setImageQueryInput(e.target.value);
                                  updateActiveSlide({ imageQuery: e.target.value });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    runImageSearch(imageQueryInput);
                                  }
                                }}
                                placeholder="e.g. server rack datacenter"
                                className="w-full bg-[#070709] border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500/70"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={isSearchingImages || !imageQueryInput.trim()}
                              onClick={() => runImageSearch(imageQueryInput)}
                              className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold disabled:opacity-50 shrink-0"
                            >
                              {isSearchingImages ? '...' : 'Search'}
                            </button>
                          </div>
                          <p className="text-[11px] text-zinc-500">
                            Sources: Wikimedia Commons & Openverse · Embedded offline in .pptx
                          </p>
                        </div>

                        {isSearchingImages ? (
                          <div className="grid grid-cols-2 gap-2.5">
                            {[1, 2, 3, 4].map((k) => (
                              <div
                                key={k}
                                className="h-24 rounded-lg bg-zinc-900 border border-zinc-800 animate-pulse"
                              />
                            ))}
                          </div>
                        ) : imageResults.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2.5">
                            {imageResults.map((img) => {
                              const isChosen = activeSlide.image?.url === img.url;
                              return (
                                <button
                                  key={img.url}
                                  type="button"
                                  onClick={() => handleSelectImageForSlide(img)}
                                  className={`group text-left rounded-lg overflow-hidden border transition-colors bg-[#111115] ${
                                    isChosen
                                      ? 'border-orange-500 ring-1 ring-orange-500/50'
                                      : 'border-zinc-800 hover:border-orange-500/60'
                                  }`}
                                >
                                  <div className="relative h-24 w-full bg-black overflow-hidden">
                                    <img
                                      src={img.thumbUrl}
                                      alt={img.caption}
                                      loading="lazy"
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                    />
                                    {isChosen && (
                                      <span className="absolute top-1.5 right-1.5 p-1 rounded-full bg-orange-500 text-black">
                                        <Check size={10} />
                                      </span>
                                    )}
                                  </div>
                                  <div className="p-1.5">
                                    <div className="text-[10px] text-zinc-200 truncate font-medium">
                                      {img.caption}
                                    </div>
                                    <div className="text-[9px] text-zinc-500 truncate">
                                      {img.credit}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-4 rounded-xl border border-zinc-800/80 bg-[#0D0D11] text-center space-y-2">
                            <p className="text-xs text-zinc-400">
                              Click <strong>Search</strong> above to preview matching visuals for this slide.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* EXPLICIT WEB ACCESS CONSENT MODAL                                    */}
      {/* ==================================================================== */}
      {showConsentModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="web-consent-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-[#111115] border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-orange-500/12 border border-orange-500/40 shrink-0">
                  <ShieldCheck size={18} className="text-orange-400" />
                </div>
                <div>
                  <h2
                    id="web-consent-title"
                    className="text-base font-display font-bold text-zinc-100"
                  >
                    Approve Web Image Access?
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Explicit session consent · Revocable anytime
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowConsentModal(false);
                  setPendingConsentAction(null);
                }}
                aria-label="Close consent dialog"
                className="p-1 text-zinc-500 hover:text-zinc-200"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-zinc-300 leading-relaxed border-y border-zinc-800/80 py-4">
              <p>
                With your permission, J.A.R.V.I.S will query public royalty-free image repositories (
                <strong className="text-zinc-100">Wikimedia Commons</strong> and{' '}
                <strong className="text-zinc-100">Openverse</strong>) so you can preview and choose visuals for your slides.
              </p>
              <ul className="space-y-1.5 text-zinc-400 list-disc pl-4">
                <li>
                  <strong className="text-zinc-200">Only short visual keywords</strong> (2–5 words per slide) are sent for image search.
                </li>
                <li>
                  Your <strong className="text-zinc-200">Memory Bank, private notes, and local prompts</strong> are never sent to external image servers.
                </li>
                <li>
                  Images you approve are embedded directly inside the exported <code className="font-mono text-zinc-200">.pptx</code> so it opens cleanly offline.
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  sfx.playClick();
                  setShowConsentModal(false);
                  setPendingConsentAction(null);
                }}
                className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
              >
                Keep Offline (Text-Only)
              </button>
              <button
                type="button"
                onClick={handleApproveConsent}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-semibold transition-colors"
              >
                Approve Web Image Access
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
