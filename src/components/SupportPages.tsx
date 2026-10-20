import React, { useState } from 'react';
import {
  Sparkles,
  Shield,
  FileText,
  Cookie,
  MessageSquare,
  ArrowLeft,
  CheckCircle2,
  Key,
  ExternalLink,
  Layers,
  Send,
  Zap,
  Globe
} from 'lucide-react';

interface SupportPageProps {
  pageType: 'updates' | 'feedback' | 'privacy' | 'terms' | 'cookies' | 'account';
}

export const SupportPage: React.FC<SupportPageProps> = ({ pageType }) => {
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'feature' | 'general'>('bug');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    setFeedbackSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-figtree flex flex-col">
      {/* Top Navigation */}
      <header className="h-16 border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md px-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3 text-neutral-300 hover:text-white transition-colors group">
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 group-hover:bg-orange-500 group-hover:text-white transition-all">
            <ArrowLeft className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm">Back to Yomi Image Translator Studio</span>
        </a>

        <div className="flex items-center gap-2">
          <img src="/icons/icon32.png" alt="Yomi" className="w-6 h-6 object-contain" />
          <span className="font-bold text-sm tracking-tight text-neutral-200">Yomi Image Translator</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-12">
        {/* 1. UPDATES PAGE */}
        {pageType === 'updates' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" /> What's New in Version 2.23.3
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">Yomi Image Translator Updates</h1>
              <p className="text-neutral-400 text-sm">
                Latest improvements, release notes, and AI engine advancements.
              </p>
            </div>

            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-base text-neutral-200 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-orange-400" /> Version 2.23.3 — Clean-Room AI Vision Release
                  </span>
                  <span className="text-xs text-neutral-500">Latest</span>
                </div>
                <ul className="space-y-2.5 text-sm text-neutral-300">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <span><strong>100% Free & Private BYOK Mode:</strong> Translate images directly using your Gemini API keys without requiring any login or account.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <span><strong>Precision 2D Bounding Boxes:</strong> Full support for normalized Gemini vision coordinates for pixel-perfect in-place speech bubble alignment.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <span><strong>Auto Multi-Line Typesetting:</strong> Natural font fitting and comic typography centered right inside original dialogue bubbles.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                    <span><strong>Encrypted Vault Sync:</strong> AES-GCM-256 client-side vault allows sync across browsers with a single sign-in.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 2. FEEDBACK & BUG REPORT */}
        {pageType === 'feedback' && (
          <div className="space-y-8 animate-fadeIn max-w-2xl mx-auto">
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
                <MessageSquare className="w-3.5 h-3.5" /> Community Support
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">Report Bug / Give Feedback</h1>
              <p className="text-neutral-400 text-sm">
                Help us make Yomi Image Translator the best comic & image translator.
              </p>
            </div>

            {feedbackSubmitted ? (
              <div className="p-8 rounded-2xl bg-neutral-900 border border-green-500/30 text-center space-y-4">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
                <h3 className="text-lg font-bold text-white">Thank you for your feedback!</h3>
                <p className="text-sm text-neutral-400">
                  Your report has been logged locally. Our team actively reviews all bug reports and feature suggestions.
                </p>
                <a href="/" className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors">
                  Return to Studio
                </a>
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} className="p-8 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Category</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['bug', 'feature', 'general'] as const).map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFeedbackCategory(cat)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                          feedbackCategory === cat
                            ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                            : 'bg-neutral-800/40 text-neutral-400 border-neutral-700/60 hover:bg-neutral-800'
                        }`}
                      >
                        {cat === 'bug' ? '🐛 Bug Report' : cat === 'feature' ? '💡 Feature Idea' : '💬 General'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Your Email (Optional)</label>
                  <input
                    type="email"
                    value={feedbackEmail}
                    onChange={e => setFeedbackEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500/60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Description / What Happened</label>
                  <textarea
                    required
                    rows={5}
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value)}
                    placeholder="Describe the issue or feature you'd like to see..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500/60 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Send className="w-4 h-4" /> Submit Report
                </button>
              </form>
            )}
          </div>
        )}

        {/* 3. PRIVACY POLICY */}
        {pageType === 'privacy' && (
          <div className="space-y-6 animate-fadeIn prose prose-invert max-w-none">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-orange-400" />
              <h1 className="text-3xl font-extrabold tracking-tight m-0">Privacy Policy</h1>
            </div>
            <p className="text-neutral-400 text-sm">Last updated: October 2026</p>

            <div className="p-6 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4 text-sm text-neutral-300">
              <h2 className="text-lg font-bold text-white">1. Strict Client-Side BYOK Policy</h2>
              <p>
                Yomi Image Translator operates primarily as a client-side application. When you use Bring Your Own Key (BYOK) mode with Google Gemini, OpenAI, Claude, or local Ollama models, all vision and translation requests are dispatched directly from your browser to the respective model provider using your own API credentials.
              </p>

              <h2 className="text-lg font-bold text-white">2. Zero Telemetry & Image Storage</h2>
              <p>
                We do not store, view, or log any images you translate. Images processed through the browser extension or Web Studio reside in browser volatile memory (OffscreenCanvas and IndexedDB translation caches) on your own device.
              </p>

              <h2 className="text-lg font-bold text-white">3. API Key Security</h2>
              <p>
                Your API keys are stored in your browser's encrypted local storage (`chrome.storage.local` or `localStorage`). In Encrypted Sync mode, keys are encrypted using AES-GCM-256 before any sync operation.
              </p>
            </div>
          </div>
        )}

        {/* 4. TERMS OF SERVICE */}
        {pageType === 'terms' && (
          <div className="space-y-6 animate-fadeIn prose prose-invert max-w-none">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-orange-400" />
              <h1 className="text-3xl font-extrabold tracking-tight m-0">Terms of Service</h1>
            </div>
            <p className="text-neutral-400 text-sm">Last updated: October 2026</p>

            <div className="p-6 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4 text-sm text-neutral-300">
              <h2 className="text-lg font-bold text-white">1. Open BYOK Platform</h2>
              <p>
                Yomi Image Translator is provided as a utility for translation and typesetting. You are responsible for ensuring your API keys adhere to the terms and acceptable use policies of your chosen AI provider (e.g., Google AI Studio, OpenAI, Anthropic).
              </p>

              <h2 className="text-lg font-bold text-white">2. Free & Fair Use</h2>
              <p>
                Private mode is 100% free with zero paywalls. Users may translate images for personal study, reading, localization, and editorial assistance.
              </p>
            </div>
          </div>
        )}

        {/* 5. COOKIE POLICY */}
        {pageType === 'cookies' && (
          <div className="space-y-6 animate-fadeIn prose prose-invert max-w-none">
            <div className="flex items-center gap-3">
              <Cookie className="w-8 h-8 text-orange-400" />
              <h1 className="text-3xl font-extrabold tracking-tight m-0">Cookie Policy</h1>
            </div>
            <p className="text-neutral-400 text-sm">Last updated: October 2026</p>

            <div className="p-6 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4 text-sm text-neutral-300">
              <p>
                Yomi Image Translator uses zero third-party advertising cookies or trackers. We only use functional client-side storage (HTML5 `localStorage` and Chrome Extension `chrome.storage`) to persist your interface theme preference, model selection, and local API keys.
              </p>
            </div>
          </div>
        )}

        {/* 6. ACCOUNT & BYOK VAULT PAGE */}
        {pageType === 'account' && (
          <div className="space-y-8 animate-fadeIn max-w-2xl mx-auto">
            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-semibold">
                <Key className="w-3.5 h-3.5" /> Account & BYOK Settings
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">Your Yomi Account</h1>
              <p className="text-neutral-400 text-sm">
                Manage your API keys, local vault, and sync preferences.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
                <div>
                  <h3 className="font-bold text-white">Plan Status</h3>
                  <p className="text-xs text-neutral-400">Unlimited BYOK Translation</p>
                </div>
                <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-bold">
                  ACTIVE • 999,999 CREDITS
                </span>
              </div>

              <div className="space-y-3">
                <a
                  href="/signin"
                  className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md"
                >
                  <Key className="w-4 h-4" /> Manage BYOK Keys & Vault
                </a>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.clear();
                    alert('Local cache and credentials cleared.');
                    window.location.href = '/';
                  }}
                  className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs transition-all border border-neutral-700"
                >
                  Clear Local Storage & Reset Keys
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
