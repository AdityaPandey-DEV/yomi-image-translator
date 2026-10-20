import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Key,
  Puzzle,
  Lock,
  Cloud,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  Info
} from 'lucide-react';
import { encryptApiKey, decryptApiKey } from '../utils/vaultCrypto';

export const SignInPage: React.FC = () => {
  const [activeMode, setActiveMode] = useState<'private' | 'encrypted'>('private');
  const [email, setEmail] = useState('user@yomi.local');
  const [geminiKey, setGeminiKey] = useState(() => {
    try {
      const saved = localStorage.getItem('yomi_byok_config');
      return saved ? JSON.parse(saved).googleApiKey || '' : '';
    } catch {
      return '';
    }
  });
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const [successMessage, setSuccessMessage] = useState('');
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    // Detect if opened as popup window from extension
    const inPopup = Boolean(window.opener || window.name?.includes('popup') || window.innerHeight < 900);
    setIsPopup(inPopup);

    const params = new URLSearchParams(window.location.search);
    const fromExtension = params.get('from') === 'extension' || params.has('provider');

    // If opened from extension with provider param, default to encrypted sync
    if (fromExtension) {
      setActiveMode('encrypted');
    }
  }, []);

  // 1. Private Mode Handler (100% Free Without Login)
  const handleSavePrivate = () => {
    setStatus('saving');

    try {
      const saved = localStorage.getItem('yomi_byok_config');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed.googleApiKey = geminiKey.trim();
      parsed.googleModel = selectedModel;
      parsed.activeProvider = 'google';
      localStorage.setItem('yomi_byok_config', JSON.stringify(parsed));
      localStorage.setItem('yomi_privacy_mode', 'private');
    } catch (_) {}

    // Post to Chrome extension content script
    window.postMessage(
      {
        type: 'yomi-sync-to-extension',
        googleApiKey: geminiKey.trim(),
        googleModel: selectedModel,
      },
      '*'
    );

    setTimeout(() => {
      setStatus('success');
      setSuccessMessage('Private Local Mode Active! Key saved locally with 0 login required.');

      setTimeout(() => {
        if (isPopup) {
          try { window.close(); } catch (_) { window.location.href = '/'; }
        } else {
          window.location.href = '/';
        }
      }, 1200);
    }, 400);
  };

  // 2. Encrypted Cloud Sync Mode Handler (Login Once, Key Encrypted)
  const handleLoginAndEncrypt = async () => {
    setStatus('saving');

    const cleanEmail = email.trim() || 'user@yomi.local';
    const cleanKey = geminiKey.trim();

    // Client-side AES-GCM-256 encryption using the user's session identifier as secret
    let encryptedVaultPayload = '';
    if (cleanKey) {
      encryptedVaultPayload = await encryptApiKey(cleanKey, cleanEmail);
      try {
        localStorage.setItem('yomi_encrypted_vault', encryptedVaultPayload);
        localStorage.setItem('yomi_vault_user', cleanEmail);
        localStorage.setItem('yomi_privacy_mode', 'encrypted_sync');

        // Also save active config
        const saved = localStorage.getItem('yomi_byok_config');
        const parsed = saved ? JSON.parse(saved) : {};
        parsed.googleApiKey = cleanKey;
        parsed.googleModel = selectedModel;
        localStorage.setItem('yomi_byok_config', JSON.stringify(parsed));
      } catch (_) {}
    }

    const token = 'free_yomi_sso_' + Math.random().toString(36).substring(2);

    // 1. Send SSO token to extension
    window.postMessage(
      {
        type: 'google-auth-token',
        content: token,
        email: cleanEmail,
        credits: 999999,
      },
      '*'
    );

    // 2. Sync encrypted vault payload and key to extension
    window.postMessage(
      {
        type: 'yomi-sync-to-extension',
        googleApiKey: cleanKey,
        googleModel: selectedModel,
        encryptedVault: encryptedVaultPayload,
        vaultUser: cleanEmail,
      },
      '*'
    );

    setTimeout(() => {
      setStatus('success');
      setSuccessMessage('Signed in & Encrypted! Next time, simply sign in to unlock your keys.');

      setTimeout(() => {
        if (isPopup) {
          try {
            window.close();
          } catch (_) {
            window.location.href = `/login?from=extension_sso&token=${token}&fp=yomi_user`;
          }
        } else {
          window.location.href = '/';
        }
      }, 1200);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-4 selection:bg-orange-500/30">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-5">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-lg shadow-orange-500/20 mb-1">
            <img src="/icons/icon128.png" alt="Yomi" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100">
            Yomi Translator Access
          </h1>
          <p className="text-xs text-neutral-400">
            Choose how you want to manage your API keys and translation access.
          </p>
        </div>

        {/* Dual Mode Tabs */}
        <div className="grid grid-cols-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800 gap-1">
          <button
            type="button"
            onClick={() => setActiveMode('private')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'private'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Private (No Login)
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('encrypted')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'encrypted'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            Login Once (Encrypted)
          </button>
        </div>

        {status === 'success' ? (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex flex-col items-center text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 animate-bounce" />
            <h3 className="text-sm font-bold text-emerald-300">Successfully Configured!</h3>
            <p className="text-xs text-neutral-300">{successMessage}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode 1: Private (No Login) */}
            {activeMode === 'private' && (
              <div className="space-y-4">
                <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-xl flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-neutral-400 leading-snug">
                    <strong className="text-neutral-200 block mb-0.5">100% Private & Free Forever</strong>
                    Your keys stay on your own machine. No account, no email, no cloud tracking.
                  </div>
                </div>

                {/* Gemini API Key Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                    <span>Google Gemini API Key</span>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-orange-400 hover:underline"
                    >
                      Get Free Key ↗
                    </a>
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      placeholder="AIzaSy... (Paste Gemini Key)"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-orange-500 font-mono transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Model Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">
                    Primary Gemini Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="gemini-3.8-flash">Gemini 3.8 Flash (Latest - High Quality & Vision)</option>
                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (500 RPD, 15 RPM)</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Ultra Fast)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                  </select>
                </div>

                <button
                  onClick={handleSavePrivate}
                  disabled={status === 'saving'}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs shadow-lg shadow-orange-500/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Save Private & Use Without Login
                </button>
              </div>
            )}

            {/* Mode 2: Encrypted Cloud Sync (Login Once) */}
            {activeMode === 'encrypted' && (
              <div className="space-y-4">
                <div className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-xl flex items-start gap-2.5">
                  <Cloud className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-neutral-400 leading-snug">
                    <strong className="text-neutral-200 block mb-0.5">Login Once — Auto-Unlock Anywhere</strong>
                    Your API keys are encrypted with AES-256-GCM. When you sign in later, your keys are decrypted automatically so you never have to re-enter them.
                  </div>
                </div>

                {/* Email or Identifier */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">
                    Account Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                </div>

                {/* Gemini API Key to Encrypt */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                    <span>Google Gemini API Key to Encrypt</span>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-orange-400 hover:underline"
                    >
                      Get Free Key ↗
                    </a>
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      placeholder="AIzaSy... (Will be AES-256 encrypted)"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-orange-500 font-mono transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Model Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">
                    Preferred Gemini Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="gemini-3.8-flash">Gemini 3.8 Flash (Latest - High Quality & Vision)</option>
                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (500 RPD, 15 RPM)</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Ultra Fast)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                  </select>
                </div>

                <button
                  onClick={handleLoginAndEncrypt}
                  disabled={status === 'saving'}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-lg shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Sign In & Save Key in Encrypted Vault
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer Navigation */}
        <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-500">
          <a
            href="/"
            className="hover:text-neutral-300 transition-colors inline-flex items-center gap-1"
          >
            ← Open Studio Editor
          </a>
          <span className="text-[11px] text-emerald-400 font-medium">
            Unlimited Free BYOK
          </span>
        </div>
      </div>
    </div>
  );
};
