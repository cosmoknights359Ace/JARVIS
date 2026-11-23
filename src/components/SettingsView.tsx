import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Volume2,
  Cpu,
  Trash2,
  FileDown,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { JarvisSettings, SystemStats } from '../types';
import { SpeechService } from '../services/speech';
import { getNotice, getShort, verifyAttributionReport } from '../services/attribution';
import { sfx } from '../services/soundEffects';
import { buildStudioModelOptions, DEFAULT_STUDIO_MODEL } from '../utils/modelOptions';

interface SettingsViewProps {
  settings: JarvisSettings;
  onUpdateSettings: (newSettings: JarvisSettings) => void;
  onClearHistory: () => void;
  onExportChat: () => void;
  stats: SystemStats;
  onRefreshOllama: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onClearHistory,
  onExportChat,
  stats,
  onRefreshOllama
}) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [attributionReport, setAttributionReport] = useState(() => verifyAttributionReport());

  useEffect(() => {
    setVoices(SpeechService.getVoices());
    setAttributionReport(verifyAttributionReport());

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        setVoices(SpeechService.getVoices());
      };
    }
  }, []);

  const handleChange = (key: keyof JarvisSettings, value: any) => {
    if (key === 'sfxEnabled') {
      sfx.enabled = Boolean(value);
    }
    onUpdateSettings({ ...settings, [key]: value });
  };

  const studioModelSuggestions = buildStudioModelOptions({
    activeModel: settings.xfillModel || DEFAULT_STUDIO_MODEL,
    installedModels: stats.installedModels,
    generalModel: settings.generalModel,
    codingModel: settings.codingModel
  });

  const testVoice = () => {
    SpeechService.speak(
      'Voice synthesis online, Sir. All systems operational.',
      {
        voiceName: settings.preferredVoice,
        rate: settings.voiceRate,
        pitch: settings.voicePitch
      }
    );
  };

  return (
    <section className="flex-1 overflow-y-auto p-6 md:p-8 bg-[#070709]" id="view-SETTINGS">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-6">
          <h1 className="text-xl font-display font-bold text-zinc-100 flex items-center gap-2.5">
            <Sliders size={20} className="text-orange-500" />
            <span>Engine & Assistant Settings</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Configure your Ollama server endpoint, sticky model routes, and speech synthesizer.
          </p>
        </div>

        {/* Ollama & Model Routing */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-orange-500" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Ollama Server & Model Routing
              </h2>
            </div>

            <button
              onClick={onRefreshOllama}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={12} className="text-orange-500" />
              <span>
                {stats.ollamaReachable
                  ? `Connected (${stats.installedModels.length} models)`
                  : 'Sync Ollama'}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-zinc-300 font-medium mb-1">
                Ollama Endpoint URL
              </label>
              <input
                type="text"
                value={settings.ollamaHost}
                onChange={(e) => handleChange('ollamaHost', e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Default endpoint when running <code>ollama serve</code>.
              </span>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                General Fast Model
              </label>
              <input
                type="text"
                value={settings.generalModel}
                onChange={(e) => handleChange('generalModel', e.target.value)}
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Used for general chat (default: qwen2.5:3b)
              </span>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Coder Model (Sticky Route)
              </label>
              <input
                type="text"
                value={settings.codingModel}
                onChange={(e) => handleChange('codingModel', e.target.value)}
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Auto-selected on coding keywords (default: qwen2.5-coder:7b)
              </span>
            </div>

            <div>
              <label htmlFor="settings-xfill-model" className="block text-zinc-300 font-medium mb-1">
                Xfill Model (Document Q&amp;A)
              </label>
              <input
                id="settings-xfill-model"
                type="text"
                list="ollama-studio-models"
                value={settings.xfillModel || DEFAULT_STUDIO_MODEL}
                onChange={(e) => handleChange('xfillModel', e.target.value)}
                placeholder="vai-doc:latest"
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Fine-tuned GGUF / Ollama model for Xfill (default: vai-doc:latest)
              </span>
            </div>

            <div>
              <label htmlFor="settings-slides-model" className="block text-zinc-300 font-medium mb-1">
                Xslide Model (PowerPoint JSON)
              </label>
              <input
                id="settings-slides-model"
                type="text"
                list="ollama-studio-models"
                value={settings.slidesModel || DEFAULT_STUDIO_MODEL}
                onChange={(e) => handleChange('slidesModel', e.target.value)}
                placeholder="vai-doc:latest"
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Fine-tuned GGUF / Ollama model for Xslide (default: vai-doc:latest)
              </span>
            </div>

            <datalist id="ollama-studio-models">
              {studioModelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Vision Model
              </label>
              <input
                type="text"
                value={settings.visionModel}
                onChange={(e) => handleChange('visionModel', e.target.value)}
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Used in Vision analyzer (default: llama3.2-vision:latest)
              </span>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Keep-Alive Duration (Minutes)
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={settings.keepAliveMinutes}
                onChange={(e) =>
                  handleChange('keepAliveMinutes', parseInt(e.target.value, 10) || 30)
                }
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3.5 py-2 font-mono text-zinc-100 focus:outline-none focus:border-orange-500 tabular-nums"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Prevents models from unloading after 5 min idle
              </span>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Temperature ({settings.temperature.toFixed(2)})
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.temperature}
                onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Precise (0.1)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Max Response Tokens ({settings.maxTokens})
              </label>
              <input
                type="range"
                min="256"
                max="4096"
                step="256"
                value={settings.maxTokens}
                onChange={(e) => handleChange('maxTokens', parseInt(e.target.value, 10))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                <span>256</span>
                <span>4096</span>
              </div>
            </div>
          </div>
        </div>

        {/* Voice, Dictation & Sound Effects */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-orange-500" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Voice Synthesis & Audio Feedback
              </h2>
            </div>
            <button
              onClick={testVoice}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-orange-400 transition-colors"
            >
              Test Voice Output
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                key: 'voiceEnabled' as const,
                title: 'Spoken TTS Replies',
                desc: 'Speak assistant replies aloud (skips code blocks)'
              },
              {
                key: 'handsFreeMode' as const,
                title: 'Hands-Free Auto-Send',
                desc: 'Automatically submit voice dictation on pause'
              },
              {
                key: 'sfxEnabled' as const,
                title: 'UI Sound Effects',
                desc: 'Subtle acoustic feedback on commands and actions'
              }
            ].map((item) => (
              <div
                key={item.key}
                className="p-3.5 rounded-xl bg-[#070709] border border-zinc-800 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-semibold text-zinc-200">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {item.desc}
                  </div>
                </div>
                <button
                  onClick={() => handleChange(item.key, !settings[item.key])}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                    settings[item.key]
                      ? 'bg-orange-500 text-black'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {settings[item.key] ? 'On' : 'Off'}
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2">
            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Synthesizer Voice
              </label>
              <select
                value={settings.preferredVoice}
                onChange={(e) => handleChange('preferredVoice', e.target.value)}
                className="w-full bg-[#070709] border border-zinc-800 rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
              >
                <option value="">Default System Voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Speech Rate ({settings.voiceRate.toFixed(1)}x)
              </label>
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.1"
                value={settings.voiceRate}
                onChange={(e) => handleChange('voiceRate', parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1">
                Voice Pitch ({settings.voicePitch.toFixed(2)})
              </label>
              <input
                type="range"
                min="0.7"
                max="1.3"
                step="0.05"
                value={settings.voicePitch}
                onChange={(e) => handleChange('voicePitch', parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Session Data & Attribution */}
        <div className="bg-[#111115] border border-zinc-800/90 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
            <div>
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Session Data & Transcripts
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Export your conversation history or reset saved sessions.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={onExportChat}
                className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 text-xs font-medium flex items-center gap-2 transition-colors"
              >
                <FileDown size={14} className="text-orange-500" />
                <span>Export Chat (.md)</span>
              </button>
              <button
                onClick={onClearHistory}
                className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-2 transition-colors"
              >
                <Trash2 size={14} />
                <span>Clear Chat History</span>
              </button>
            </div>
          </div>

          {/* Creator Attribution & Copyright Seal */}
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-zinc-200 flex items-center gap-2">
                <ShieldCheck
                  size={15}
                  className={
                    attributionReport.ok && stats.attributionVerified
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }
                />
                <span>{getShort()}</span>
              </span>
              <span
                className={`font-mono ${
                  attributionReport.ok && stats.attributionVerified
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {attributionReport.ok && stats.attributionVerified
                  ? `Verified · Seal ${attributionReport.seal}`
                  : 'Integrity Warning · Attribution Modified'}
              </span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{getNotice()}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 font-mono tabular-nums pt-1">
              <span>Client Seal: {attributionReport.checks.sealValid ? 'Valid' : 'Tampered'}</span>
              <span aria-hidden="true">·</span>
              <span>Record Frozen: {attributionReport.checks.recordFrozen ? 'Locked' : 'Unlocked'}</span>
              <span aria-hidden="true">·</span>
              <span>Server LICENSE/NOTICE: {stats.licenseFileIntact ? 'Intact' : 'Modified'}</span>
              <span aria-hidden="true">·</span>
              <span>Protected under 17 U.S.C. § 1202</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
