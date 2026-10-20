import React from 'react';
import {
  Sparkles,
  Key,
  Sun,
  Moon,
  BookOpen,
  Image as ImageIcon,
  FileText,
  HelpCircle,
  Puzzle,
  Download,
  FolderOpen
} from 'lucide-react';
import { BYOKConfig } from '../types';

interface HeaderProps {
  currentTab: 'studio' | 'reader' | 'script';
  setCurrentTab: (tab: 'studio' | 'reader' | 'script') => void;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => void;
  byokConfig: BYOKConfig;
  onOpenByokModal: () => void;
  onOpenExtensionModal: () => void;
  onLoadSample: (type: 'shonen' | 'romance') => void;
  onOpenHelp: () => void;
  onUploadClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  isDarkMode,
  setIsDarkMode,
  byokConfig,
  onOpenByokModal,
  onOpenExtensionModal,
  onLoadSample,
  onOpenHelp,
  onUploadClick,
}) => {
  const isKeyActive = Boolean(
    (byokConfig.activeProvider === 'google' && byokConfig.googleApiKey) ||
    (byokConfig.activeProvider === 'openai' && byokConfig.openaiApiKey) ||
    (byokConfig.activeProvider === 'anthropic' && byokConfig.anthropicApiKey) ||
    (byokConfig.activeProvider === 'deepseek' && byokConfig.deepseekApiKey) ||
    (byokConfig.activeProvider === 'local' && byokConfig.localUrl)
  );

  return (
    <header className="h-16 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md px-4 flex items-center justify-between z-30 select-none shrink-0">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white font-black text-xl">
          {/* Yomi Gate Icon */}
          <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
            <path d="M2 4h20v2H2V4zm2 3h16v1.5H4V7zm3 2.5h2V20H7V9.5zm8 0h2V20h-2V9.5zM3 2h18v1.5H3V2z" />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-neutral-100 tracking-tight">Yomi</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
              Manga Studio 2.0
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 leading-none mt-0.5">
            AI Manga, Manhwa & Webtoon Translator
          </p>
        </div>
      </div>

      {/* Mode Navigation */}
      <nav className="hidden md:flex items-center p-1 bg-neutral-900 rounded-xl border border-neutral-800">
        <button
          onClick={() => setCurrentTab('studio')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            currentTab === 'studio'
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          Studio Editor
        </button>
        <button
          onClick={() => setCurrentTab('reader')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            currentTab === 'reader'
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Reading Mode
        </button>
        <button
          onClick={() => setCurrentTab('script')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            currentTab === 'script'
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Script Editor
        </button>
      </nav>

      {/* Action Controls & Utilities */}
      <div className="flex items-center gap-2">
        {/* Sample Manga Quick Loaders */}
        <div className="hidden lg:flex items-center gap-1.5">
          <button
            onClick={() => onLoadSample('shonen')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 transition-colors"
            title="Load sample Shonen battle manga page"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Sample: Shonen
          </button>
          <button
            onClick={() => onLoadSample('romance')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 transition-colors"
            title="Load sample Romance dialogue page"
          >
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            Sample: Romance
          </button>
        </div>

        {/* Upload Button */}
        <button
          onClick={onUploadClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5 text-orange-400" />
          Upload
        </button>

        {/* Extension Button */}
        <button
          onClick={onOpenExtensionModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 transition-colors"
          title="Install Browser Extension for Chrome, Edge, Brave"
        >
          <Puzzle className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Extension</span>
        </button>

        {/* BYOK Status Button */}
        <button
          onClick={onOpenByokModal}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isKeyActive
              ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-400 hover:bg-emerald-900/50'
              : 'bg-amber-950/30 border-amber-600/40 text-amber-400 hover:bg-amber-900/40'
          }`}
          title="Configure API Keys (Gemini, OpenAI, Claude, DeepSeek, Local Ollama)"
        >
          <Key className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {isKeyActive ? `${byokConfig.activeProvider.toUpperCase()} Active` : 'BYOK Keys'}
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              isKeyActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
        </button>

        {/* Shortcuts & Help */}
        <button
          onClick={onOpenHelp}
          className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          title="Keyboard Shortcuts & Help"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="p-2 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          title="Toggle Light/Dark Theme"
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
        </button>
      </div>
    </header>
  );
};
