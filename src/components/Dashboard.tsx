import React, { useState } from 'react';
import {
  Key, Shield, Users, Globe, LogOut, ExternalLink, Eye, EyeOff,
  Plus, Trash2, CheckCircle2, AlertCircle, Loader2, RefreshCw,
  Lock, Share2, Zap, ArrowRight
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  signOutUser, saveApiKey, deleteApiKey, updateUserMode,
  getIdToken, sendTokenToExtension, type StoredApiKey
} from '../lib/firebase';

// ============================================================
// Provider Configuration
// ============================================================

const PROVIDERS: Record<string, { name: string; models: { id: string; name: string }[]; placeholder: string; getKeyUrl: string; getKeyText: string }> = {
  google: {
    name: 'Google Gemini',
    models: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Latest)' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite (Ultra Fast)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Stable)' },
    ],
    placeholder: 'AIzaSy...',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    getKeyText: 'Get Free Key from Google AI Studio',
  },
  openrouter: {
    name: 'OpenRouter',
    models: [
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Cheap)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    ],
    placeholder: 'sk-or-v1-...',
    getKeyUrl: 'https://openrouter.ai/keys',
    getKeyText: 'Get Key from OpenRouter',
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
    ],
    placeholder: 'sk-proj-...',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    getKeyText: 'Get Key from OpenAI',
  },
  anthropic: {
    name: 'Anthropic Claude',
    models: [
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    ],
    placeholder: 'sk-ant-...',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    getKeyText: 'Get Key from Anthropic',
  },
  groq: {
    name: 'Groq',
    models: [
      { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision' },
      { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision' },
    ],
    placeholder: 'gsk_...',
    getKeyUrl: 'https://console.groq.com/keys',
    getKeyText: 'Get Key from Groq',
  },
  deepseek: {
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
    ],
    placeholder: 'sk-...',
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    getKeyText: 'Get Key from DeepSeek',
  },
};

// ============================================================
// Helpers
// ============================================================

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ============================================================
// Dashboard Component
// ============================================================

export function Dashboard() {
  const { user, profile, apiKeys, refreshProfile, refreshKeys } = useAuth();

  // Mode switching
  const [modeLoading, setModeLoading] = useState(false);

  // Add key form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('google');
  const [keyInput, setKeyInput] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS.google.models[0].id);
  const [shareKey, setShareKey] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Delete key state
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null);

  // Extension sync state
  const [extensionStatus, setExtensionStatus] = useState<'idle' | 'syncing' | 'connected' | 'failed'>('idle');

  // Sign out state
  const [signingOut, setSigningOut] = useState(false);

  const currentMode = profile?.mode || 'private';

  // ----- Handlers -----

  const handleModeChange = async (mode: 'private' | 'shared') => {
    if (!user || mode === currentMode) return;
    setModeLoading(true);
    try {
      await updateUserMode(user.uid, mode);
      await refreshProfile();
    } catch (err) {
      console.error('Failed to update mode:', err);
    } finally {
      setModeLoading(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSelectedModel(PROVIDERS[provider].models[0].id);
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSaveKey = async () => {
    if (!user) return;
    if (!keyInput.trim()) {
      setSaveError('Please enter an API key.');
      return;
    }
    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveApiKey(user.uid, selectedProvider, keyInput.trim(), selectedModel, shareKey);
      await refreshKeys();
      setKeyInput('');
      setShareKey(false);
      setSaveSuccess(true);
      setShowAddForm(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save key.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    if (!user) return;
    setDeletingProvider(provider);
    try {
      await deleteApiKey(user.uid, provider);
      await refreshKeys();
    } catch (err) {
      console.error('Failed to delete key:', err);
    } finally {
      setDeletingProvider(null);
    }
  };

  const handleSyncExtension = async () => {
    setExtensionStatus('syncing');
    try {
      const token = await getIdToken();
      if (!token) {
        setExtensionStatus('failed');
        return;
      }
      const success = await sendTokenToExtension(token, user?.email || '');
      setExtensionStatus(success ? 'connected' : 'failed');
    } catch {
      setExtensionStatus('failed');
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutUser();
    } catch (err) {
      console.error('Sign out error:', err);
      setSigningOut(false);
    }
  };

  // ----- Render -----

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">

        {/* ===== Section 1: Profile Card ===== */}
        <div className="mb-8 flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-4">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="h-14 w-14 rounded-full border-2 border-neutral-700 object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-neutral-700 bg-neutral-800 text-lg font-bold text-orange-400">
                {getInitials(profile?.displayName || user?.displayName || user?.email || 'U')}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-white">
                {profile?.displayName || user?.displayName || 'User'}
              </h1>
              <p className="text-sm text-neutral-400">{user?.email}</p>
              <span
                className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  currentMode === 'shared'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-orange-500/10 text-orange-400'
                }`}
              >
                {currentMode === 'shared' ? (
                  <><Share2 className="h-3 w-3" /> Shared Mode</>
                ) : (
                  <><Lock className="h-3 w-3" /> Private Mode</>
                )}
              </span>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-red-400 disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            Sign Out
          </button>
        </div>

        {/* ===== Section 2: Translation Mode Selector ===== */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold text-white">Translation Mode</h2>
            {modeLoading && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Private Mode Card */}
            <button
              onClick={() => handleModeChange('private')}
              disabled={modeLoading}
              className={`group relative rounded-2xl border p-6 text-left transition-all disabled:opacity-60 ${
                currentMode === 'private'
                  ? 'border-orange-500 bg-orange-500/5'
                  : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700'
              }`}
            >
              {currentMode === 'private' && (
                <CheckCircle2 className="absolute right-4 top-4 h-5 w-5 text-orange-500" />
              )}
              <Lock className={`mb-3 h-8 w-8 ${currentMode === 'private' ? 'text-orange-500' : 'text-neutral-500'}`} />
              <h3 className="mb-1 text-base font-bold text-white">Private Mode</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Use your own API keys. Your credits, your usage. Keys are stored securely in your account.
              </p>
            </button>

            {/* Shared Mode Card */}
            <button
              onClick={() => handleModeChange('shared')}
              disabled={modeLoading}
              className={`group relative rounded-2xl border p-6 text-left transition-all disabled:opacity-60 ${
                currentMode === 'shared'
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700'
              }`}
            >
              {currentMode === 'shared' && (
                <CheckCircle2 className="absolute right-4 top-4 h-5 w-5 text-emerald-500" />
              )}
              <Share2 className={`mb-3 h-8 w-8 ${currentMode === 'shared' ? 'text-emerald-500' : 'text-neutral-500'}`} />
              <h3 className="mb-1 text-base font-bold text-white">Shared Mode</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Contribute an active API key to the community pool. In return, you can use the shared pool when your key runs out.
              </p>
            </button>
          </div>
        </div>

        {/* ===== Section 3: API Key Vault ===== */}
        <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="mb-1 flex items-center gap-2">
            <Key className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold text-white">API Key Vault</h2>
          </div>
          <p className="mb-5 text-sm text-neutral-400">
            Your keys are stored securely in your cloud account.
          </p>

          {/* Success toast */}
          {saveSuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              API key saved successfully.
            </div>
          )}

          {/* Key List */}
          {apiKeys.length > 0 ? (
            <div className="mb-5 space-y-3">
              {apiKeys.map((key) => (
                <KeyRow
                  key={key.provider}
                  storedKey={key}
                  deleting={deletingProvider === key.provider}
                  onDelete={() => handleDeleteKey(key.provider)}
                />
              ))}
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-dashed border-neutral-800 px-6 py-10 text-center">
              <Key className="mx-auto mb-3 h-8 w-8 text-neutral-600" />
              <p className="text-sm text-neutral-500">No API keys yet. Add one below to start translating.</p>
            </div>
          )}

          {/* Add Key Toggle */}
          {!showAddForm ? (
            <button
              onClick={() => {
                setShowAddForm(true);
                setSaveError(null);
                setSaveSuccess(false);
              }}
              className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-sm font-medium text-neutral-300 transition-colors hover:border-orange-500 hover:text-orange-400"
            >
              <Plus className="h-4 w-4" />
              Add New Key
            </button>
          ) : (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Add New Key</h3>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setKeyInput('');
                    setSaveError(null);
                  }}
                  className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Cancel
                </button>
              </div>

              {/* Provider Select */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-orange-500"
                >
                  {Object.entries(PROVIDERS).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key Input */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKeyInput ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={PROVIDERS[selectedProvider].placeholder}
                    className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 pr-10 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(!showKeyInput)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 transition-colors hover:text-neutral-300"
                  >
                    {showKeyInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Model Select */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-orange-500"
                >
                  {PROVIDERS[selectedProvider].models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Get API Key Link */}
              <a
                href={PROVIDERS[selectedProvider].getKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 inline-flex items-center gap-1.5 text-sm text-orange-400 transition-colors hover:text-orange-300"
              >
                {PROVIDERS[selectedProvider].getKeyText}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>

              {/* Share Key Checkbox (only in shared mode) */}
              {currentMode === 'shared' && (
                <label className="mb-4 flex cursor-pointer items-center gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={shareKey}
                    onChange={(e) => setShareKey(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-orange-500 accent-orange-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-white">Share this key with community</span>
                    <p className="text-xs text-neutral-500">Others in the shared pool can use this key when theirs runs out.</p>
                  </div>
                </label>
              )}

              {/* Error */}
              {saveError && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={handleSaveKey}
                disabled={saveLoading || !keyInput.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-orange-500"
              >
                {saveLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Key className="h-4 w-4" />
                    Save Key
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ===== Section 4: Extension Connection ===== */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="mb-1 flex items-center gap-2">
            <Globe className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold text-white">Chrome Extension</h2>
          </div>

          <div className="mb-4 flex items-center gap-2">
            {extensionStatus === 'connected' ? (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-emerald-400">Connected</span>
              </>
            ) : extensionStatus === 'failed' ? (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-sm font-medium text-red-400">Not Connected</span>
              </>
            ) : (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-neutral-600" />
                <span className="text-sm font-medium text-neutral-400">Not Connected</span>
              </>
            )}
          </div>

          <button
            onClick={handleSyncExtension}
            disabled={extensionStatus === 'syncing'}
            className="mb-4 flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
          >
            {extensionStatus === 'syncing' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Syncing…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Sync Login to Extension
              </>
            )}
          </button>

          <p className="mb-3 text-sm leading-relaxed text-neutral-400">
            Install the extension from the Chrome Web Store to translate manga directly on any website.
          </p>

          <a
            href="https://chromewebstore.google.com/detail/manga-translator/pjlblckbipgkomdiojhkmaeffbhkebld"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-orange-400 transition-colors hover:text-orange-300"
          >
            Chrome Web Store
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Key Row Sub-Component
// ============================================================

function KeyRow({
  storedKey,
  deleting,
  onDelete,
}: {
  storedKey: StoredApiKey;
  deleting: boolean;
  onDelete: () => void;
}) {
  const provider = PROVIDERS[storedKey.provider];
  const providerName = provider?.name || storedKey.provider;

  return (
    <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-orange-400">
          <Key className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">{providerName}</span>
            {storedKey.isShared && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                Shared
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-mono">{maskKey(storedKey.apiKey)}</span>
            <span className="text-neutral-700">·</span>
            <span>{storedKey.model}</span>
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="ml-3 shrink-0 rounded-lg p-2 text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
        title="Delete key"
      >
        {deleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
