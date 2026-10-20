import React, { useState } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  Cpu,
  Sparkles,
  ExternalLink,
  Eye,
  EyeOff,
  Check
} from 'lucide-react';
import { BYOKConfig, AIProvider } from '../types';

interface BYOKModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BYOKConfig;
  onSaveConfig: (updated: Partial<BYOKConfig>) => void;
}

export const BYOKModal: React.FC<BYOKModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [localConfig, setLocalConfig] = useState<BYOKConfig>({ ...config });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  const toggleShowKey = (id: string) => {
    setShowKey(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = () => {
    onSaveConfig(localConfig);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 600);
  };

  const providers: { id: AIProvider; name: string; badge: string; desc: string }[] = [
    { id: 'google', name: 'Google Gemini', badge: 'Recommended', desc: 'Fastest vision & manga reasoning with Gemini 2.0 Flash.' },
    { id: 'openai', name: 'OpenAI', badge: 'GPT-4o', desc: 'Industry-standard multilingual manga translation.' },
    { id: 'anthropic', name: 'Anthropic Claude', badge: 'Claude 3.5', desc: 'Poetic, expressive narrative character dialogue.' },
    { id: 'deepseek', name: 'DeepSeek', badge: 'Cost Efficient', desc: 'DeepSeek V3 / R1 reasoning capabilities.' },
    { id: 'openrouter', name: 'OpenRouter', badge: 'Multi-LLM', desc: 'Universal gateway for 200+ models.' },
    { id: 'local', name: 'Local Ollama / vLLM', badge: '100% Private', desc: 'Self-hosted vision models on your local GPU.' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/15 text-orange-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-100">Bring Your Own Key (BYOK)</h2>
              <p className="text-xs text-neutral-400">
                Direct AI translation with your own API keys. Keys stay strictly in your local browser.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Active Provider Selector */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block mb-2">
              Select Primary AI Engine
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {providers.map(p => {
                const isSelected = localConfig.activeProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setLocalConfig(prev => ({ ...prev, activeProvider: p.id }))}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-orange-500/10 border-orange-500 text-neutral-100 shadow-sm shadow-orange-500/10'
                        : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-neutral-200">{p.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 font-mono text-neutral-300">
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-500 line-clamp-2 leading-tight">
                      {p.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration for Selected Provider */}
          <div className="p-4 bg-neutral-950/80 rounded-xl border border-neutral-800 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800/80">
              <span className="text-xs font-bold text-neutral-200 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-orange-400" />
                {providers.find(p => p.id === localConfig.activeProvider)?.name} Configuration
              </span>
              <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Stored in LocalStorage
              </span>
            </div>

            {/* Google Gemini */}
            {localConfig.activeProvider === 'google' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Google Gemini API Key</label>
                  <div className="relative">
                    <input
                      type={showKey.google ? 'text' : 'password'}
                      value={localConfig.googleApiKey}
                      onChange={e =>
                        setLocalConfig(prev => ({ ...prev, googleApiKey: e.target.value }))
                      }
                      placeholder="AIzaSy..."
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-100 font-mono focus:outline-none focus:border-orange-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey('google')}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300"
                    >
                      {showKey.google ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Model Version</label>
                  <select
                    value={localConfig.googleModel}
                    onChange={e =>
                      setLocalConfig(prev => ({ ...prev, googleModel: e.target.value }))
                    }
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Latest & Best)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  </select>
                </div>
              </div>
            )}

            {/* OpenAI */}
            {localConfig.activeProvider === 'openai' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">OpenAI API Key</label>
                  <div className="relative">
                    <input
                      type={showKey.openai ? 'text' : 'password'}
                      value={localConfig.openaiApiKey}
                      onChange={e =>
                        setLocalConfig(prev => ({ ...prev, openaiApiKey: e.target.value }))
                      }
                      placeholder="sk-proj-..."
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-100 font-mono focus:outline-none focus:border-orange-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey('openai')}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300"
                    >
                      {showKey.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Model Version</label>
                  <select
                    value={localConfig.openaiModel}
                    onChange={e =>
                      setLocalConfig(prev => ({ ...prev, openaiModel: e.target.value }))
                    }
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="gpt-4o">GPT-4o (High-Res Multimodal)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini (Fast)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Anthropic */}
            {localConfig.activeProvider === 'anthropic' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Anthropic API Key</label>
                  <div className="relative">
                    <input
                      type={showKey.anthropic ? 'text' : 'password'}
                      value={localConfig.anthropicApiKey}
                      onChange={e =>
                        setLocalConfig(prev => ({ ...prev, anthropicApiKey: e.target.value }))
                      }
                      placeholder="sk-ant-..."
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-100 font-mono focus:outline-none focus:border-orange-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey('anthropic')}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300"
                    >
                      {showKey.anthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Model Version</label>
                  <select
                    value={localConfig.anthropicModel}
                    onChange={e =>
                      setLocalConfig(prev => ({ ...prev, anthropicModel: e.target.value }))
                    }
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                    <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                  </select>
                </div>
              </div>
            )}

            {/* Local Ollama */}
            {localConfig.activeProvider === 'local' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Local Ollama / LM Studio URL</label>
                  <input
                    type="text"
                    value={localConfig.localUrl}
                    onChange={e =>
                      setLocalConfig(prev => ({ ...prev, localUrl: e.target.value }))
                    }
                    placeholder="http://localhost:11434/v1"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-100 font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Model Tag</label>
                  <input
                    type="text"
                    value={localConfig.localModel}
                    onChange={e =>
                      setLocalConfig(prev => ({ ...prev, localModel: e.target.value }))
                    }
                    placeholder="llama3.2-vision:latest"
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-100 font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Advanced Manga Context & Localization Settings */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 block">
              Manga Localization Settings
            </label>

            <div className="p-3 bg-neutral-950/60 rounded-xl border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">
                    Preserve Manga Honorifics
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    Retains character suffixes (-san, -kun, -chan, -senpai, -sama)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localConfig.preserveHonorifics}
                  onChange={e =>
                    setLocalConfig(prev => ({ ...prev, preserveHonorifics: e.target.checked }))
                  }
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80">
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">
                    Multi-Page Context Memory
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    Passes character names and narrative summary across chapter pages
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localConfig.contextAwareness}
                  onChange={e =>
                    setLocalConfig(prev => ({ ...prev, contextAwareness: e.target.checked }))
                  }
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-neutral-400 block mb-1">
                Custom System Prompt Instructions (Optional)
              </label>
              <textarea
                value={localConfig.customPrompt}
                onChange={e =>
                  setLocalConfig(prev => ({ ...prev, customPrompt: e.target.value }))
                }
                rows={2}
                placeholder="e.g. Translate with high fantasy jargon, keep protagonist's name as 'Ren'..."
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 flex items-center justify-between bg-neutral-950/80">
          <p className="text-[11px] text-neutral-500">
            No API key? Intelligent offline heuristic detection is used automatically.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/25 transition-all cursor-pointer"
            >
              {savedNotice ? <Check className="w-4 h-4" /> : null}
              {savedNotice ? 'Saved!' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
