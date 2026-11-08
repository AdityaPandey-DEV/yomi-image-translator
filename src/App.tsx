import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { Header } from './components/Header';
import { InteractiveCanvas } from './components/InteractiveCanvas';
import { SidebarEditor } from './components/SidebarEditor';
import { ThumbnailCarousel } from './components/ThumbnailCarousel';
import { BYOKModal } from './components/BYOKModal';
import { HelpModal } from './components/HelpModal';
import { ExtensionModal } from './components/ExtensionModal';
import { ReadingMode } from './components/ReadingMode';
import { ScriptEditor } from './components/ScriptEditor';
import { SupportPage } from './components/SupportPages';
import {
  PageImage,
  TextObject,
  BYOKConfig,
  EditorTool,
  ViewMode
} from './types';
import { createSampleShonenPage, createSampleRomancePage } from './utils/sampleManga';
import { parseUploadedFiles } from './utils/fileIo';
import { inpaintAllBubbles } from './utils/inpainting';
import { detectAndTranslateImage } from './services/aiTranslator';
import { UploadCloud, Loader2 } from 'lucide-react';

const DEFAULT_BYOK_CONFIG: BYOKConfig = {
  activeProvider: 'google',
  googleApiKey: '',
  googleModel: 'gemini-2.5-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  anthropicApiKey: '',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  xaiApiKey: '',
  xaiModel: 'grok-2-vision-1212',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.0-flash-001',
  localUrl: 'http://localhost:11434/v1',
  localModel: 'llama3.2-vision',
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  customPrompt: '',
  preserveHonorifics: true,
  sfxMode: 'translate',
  contextAwareness: true,
  fontDefault: 'Comic Neue',
  strokeEnabled: true,
  uppercaseDefault: true,
  inpaintMultiplier: 1.15,
};

function MainRouter() {
  const { user, loading } = useAuth();
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

  // Legal and support pages
  if (pathname === '/updates') return <SupportPage pageType="updates" />;
  if (pathname === '/feedback') return <SupportPage pageType="feedback" />;
  if (pathname === '/privacy') return <SupportPage pageType="privacy" />;
  if (pathname === '/terms') return <SupportPage pageType="terms" />;
  if (pathname === '/cookies') return <SupportPage pageType="cookies" />;
  if (pathname === '/auth/callback') return <AuthPage />;
  if (pathname === '/studio') return <StudioView />;

  // Loading state
  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-neutral-950 text-neutral-400 gap-3">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Loading Cloud Vault...
        </span>
      </div>
    );
  }

  // Root "/": If signed in, show Dashboard. If not signed in, show AuthPage.
  if (!user) {
    return <AuthPage />;
  }

  return <Dashboard />;
}

// Studio Editor View (available via /studio)
function StudioView() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentTab, setCurrentTab] = useState<'studio' | 'reader' | 'script'>('studio');
  const [viewMode, setViewMode] = useState<ViewMode>('translated');
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [brushSize, setBrushSize] = useState(16);

  const [byokConfig, setByokConfig] = useState<BYOKConfig>(() => {
    try {
      const saved = localStorage.getItem('yomi_byok_config');
      return saved ? { ...DEFAULT_BYOK_CONFIG, ...JSON.parse(saved) } : DEFAULT_BYOK_CONFIG;
    } catch {
      return DEFAULT_BYOK_CONFIG;
    }
  });

  const [pages, setPages] = useState<PageImage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isBatchTranslating, setIsBatchTranslating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  const [showByokModal, setShowByokModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [isDraggingFileOver, setIsDraggingFileOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentPage = pages[currentPageIndex] || null;
  const selectedBubble =
    currentPage?.textObjects.find(b => b.id === selectedBubbleId) || null;

  const updateByokConfig = (updated: Partial<BYOKConfig>) => {
    setByokConfig(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('yomi_byok_config', JSON.stringify(next));
      return next;
    });
  };

  const handleLoadSample = async (type: 'shonen' | 'romance') => {
    const sampleUrl =
      type === 'shonen' ? await createSampleShonenPage() : await createSampleRomancePage();
    const newPage: PageImage = {
      id: `page-${type}-${Date.now()}`,
      filename: `sample_${type}_chapter_01.png`,
      originalSrc: sampleUrl,
      inpaintedSrc: null,
      textObjects: [],
      history: { past: [], future: [] },
      width: 900,
      height: 1350,
      status: 'idle',
      createdDate: Date.now(),
    };
    setPages(prev => [...prev, newPage]);
    setCurrentPageIndex(pages.length);
  };

  const handleUpdateBubble = (updated: TextObject) => {
    if (!currentPage) return;
    setPages(prev =>
      prev.map((p, i) => {
        if (i !== currentPageIndex) return p;
        const newObjects = p.textObjects.map(b => (b.id === updated.id ? updated : b));
        return {
          ...p,
          textObjects: newObjects,
          history: { past: [...p.history.past, p.textObjects], future: [] },
        };
      })
    );
  };

  const handleDeleteBubble = useCallback(
    (bubbleId: string) => {
      if (!currentPage) return;
      setPages(prev =>
        prev.map((p, i) => {
          if (i !== currentPageIndex) return p;
          const newObjects = p.textObjects.filter(b => b.id !== bubbleId);
          return {
            ...p,
            textObjects: newObjects,
            history: { past: [...p.history.past, p.textObjects], future: [] },
          };
        })
      );
      setSelectedBubbleId(null);
    },
    [currentPage, currentPageIndex]
  );

  const handleDuplicateBubble = (bubbleId: string) => {
    if (!currentPage) return;
    const target = currentPage.textObjects.find(b => b.id === bubbleId);
    if (!target) return;
    const duplicated: TextObject = {
      ...target,
      id: `bubble-${Date.now()}`,
      x: target.x + 20,
      y: target.y + 20,
    };
    setPages(prev =>
      prev.map((p, i) => {
        if (i !== currentPageIndex) return p;
        return {
          ...p,
          textObjects: [...p.textObjects, duplicated],
          history: { past: [...p.history.past, p.textObjects], future: [] },
        };
      })
    );
    setSelectedBubbleId(duplicated.id);
  };

  const handleAddBubble = (coords: { x: number; y: number }) => {
    if (!currentPage) return;
    const newBubble: TextObject = {
      id: `bubble-${Date.now()}`,
      x: coords.x,
      y: coords.y,
      width: 140,
      height: 90,
      angle: 0,
      raw_text: '',
      text: 'TRANSLATION',
      font: byokConfig.fontDefault,
      fontSize: 16,
      autoFit: true,
      fontColor: '#000000',
      strokeColor: '#ffffff',
      strokeWidth: 3,
      strokeDisabled: !byokConfig.strokeEnabled,
      textAlign: 'center',
      vertical: false,
      uppercase: byokConfig.uppercaseDefault,
      lineHeight: 1.15,
    };
    setPages(prev =>
      prev.map((p, i) => {
        if (i !== currentPageIndex) return p;
        return {
          ...p,
          textObjects: [...p.textObjects, newBubble],
          history: { past: [...p.history.past, p.textObjects], future: [] },
        };
      })
    );
    setSelectedBubbleId(newBubble.id);
  };

  const handleUndo = useCallback(() => {
    if (!currentPage || currentPage.history.past.length === 0) return;
    setPages(prev =>
      prev.map((p, i) => {
        if (i !== currentPageIndex) return p;
        const past = [...p.history.past];
        const previousState = past.pop()!;
        return {
          ...p,
          textObjects: previousState,
          history: { past, future: [p.textObjects, ...p.history.future] },
        };
      })
    );
  }, [currentPage, currentPageIndex]);

  const handleRedo = useCallback(() => {
    if (!currentPage || currentPage.history.future.length === 0) return;
    setPages(prev =>
      prev.map((p, i) => {
        if (i !== currentPageIndex) return p;
        const future = [...p.history.future];
        const nextState = future.shift()!;
        return {
          ...p,
          textObjects: nextState,
          history: { past: [...p.history.past, p.textObjects], future },
        };
      })
    );
  }, [currentPage, currentPageIndex]);

  const translatePageAtIndex = async (index: number) => {
    const page = pages[index];
    if (!page) return;
    const prevContext = index > 0 ? pages[index - 1].contextSummary || '' : '';

    setPages(prev =>
      prev.map((p, i) => (i === index ? { ...p, status: 'translating' } : p))
    );

    try {
      const detection = await detectAndTranslateImage(page.originalSrc, byokConfig, prevContext);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise(r => {
        img.onload = r;
        img.src = page.originalSrc;
      });

      const inpaintedDataUrl = await inpaintAllBubbles(
        img,
        detection.textObjects,
        byokConfig.inpaintMultiplier
      );

      setPages(prev =>
        prev.map((p, i) => {
          if (i !== index) return p;
          return {
            ...p,
            inpaintedSrc: inpaintedDataUrl,
            textObjects: detection.textObjects,
            contextSummary: detection.pageContextSummary,
            status: 'done',
          };
        })
      );
    } catch (err: any) {
      console.error('Translation error on page', index, err);
      setPages(prev =>
        prev.map((p, i) =>
          i === index
            ? { ...p, status: 'error', errorMessage: err.message || 'Translation failed' }
            : p
        )
      );
    }
  };

  const handleTranslateCurrentPage = async () => {
    if (isProcessing || !currentPage) return;
    setIsProcessing(true);
    await translatePageAtIndex(currentPageIndex);
    setIsProcessing(false);
  };

  const handleInpaintCurrentPage = async () => {
    if (!currentPage) return;
    setIsProcessing(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise(r => {
        img.onload = r;
        img.src = currentPage.originalSrc;
      });
      const inpaintedDataUrl = await inpaintAllBubbles(
        img,
        currentPage.textObjects,
        byokConfig.inpaintMultiplier
      );
      setPages(prev =>
        prev.map((p, i) => (i === currentPageIndex ? { ...p, inpaintedSrc: inpaintedDataUrl } : p))
      );
    } catch (err) {
      console.error('Inpaint failed', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTranslateAllPages = async () => {
    if (isBatchTranslating || pages.length === 0) return;
    setIsBatchTranslating(true);
    setBatchProgress({ current: 0, total: pages.length });

    for (let i = 0; i < pages.length; i++) {
      setBatchProgress({ current: i + 1, total: pages.length });
      await translatePageAtIndex(i);
    }

    setIsBatchTranslating(false);
  };

  const handleFilesUpload = async (fileList: FileList | File[]) => {
    const { pages: newPages, projectConfig } = await parseUploadedFiles(fileList, byokConfig);
    if (newPages.length > 0) {
      setPages(prev => [...prev, ...newPages]);
      setCurrentPageIndex(pages.length);
    }
    if (projectConfig) {
      updateByokConfig(projectConfig);
    }
  };

  return (
    <div
      className={`w-screen h-screen flex flex-col overflow-hidden bg-neutral-950 text-neutral-100 ${
        isDarkMode ? 'dark' : ''
      }`}
      onDragOver={e => {
        e.preventDefault();
        setIsDraggingFileOver(true);
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingFileOver(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setIsDraggingFileOver(false);
        if (e.dataTransfer.files) handleFilesUpload(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept=".png,.jpg,.jpeg,.webp,.avif,.zip,.cbz,.yomi"
        onChange={e => {
          if (e.target.files) handleFilesUpload(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />

      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        byokConfig={byokConfig}
        onOpenByokModal={() => setShowByokModal(true)}
        onOpenExtensionModal={() => setShowExtensionModal(true)}
        onLoadSample={handleLoadSample}
        onOpenHelp={() => setShowHelpModal(true)}
        onUploadClick={() => fileInputRef.current?.click()}
      />

      {currentTab === 'studio' && (
        <main className="flex-1 flex overflow-hidden relative">
          <InteractiveCanvas
            currentPage={currentPage}
            selectedBubbleId={selectedBubbleId}
            onSelectBubble={setSelectedBubbleId}
            onUpdateBubble={handleUpdateBubble}
            onAddBubble={(x, y) => handleAddBubble({ x, y })}
            activeTool={activeTool}
            viewMode={viewMode}
            setViewMode={setViewMode}
            brushSize={brushSize}
            onCommitMaskStroke={() => {}}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={Boolean(currentPage && currentPage.history.past.length > 0)}
            canRedo={Boolean(currentPage && currentPage.history.future.length > 0)}
          />

          <SidebarEditor
            currentPage={currentPage}
            selectedBubble={selectedBubble}
            onUpdateBubble={handleUpdateBubble}
            onDeleteBubble={handleDeleteBubble}
            onDuplicateBubble={bubble => handleDuplicateBubble(bubble.id)}
            onAddBubbleClick={() => setActiveTool('bubble-add')}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            byokConfig={byokConfig}
            onUpdateConfig={updateByokConfig}
            onTranslateCurrentPage={handleTranslateCurrentPage}
            onInpaintCurrentPage={handleInpaintCurrentPage}
            isProcessing={isProcessing}
          />
        </main>
      )}

      {currentTab === 'reader' && (
        <ReadingMode pages={pages} onExitReader={() => setCurrentTab('studio')} />
      )}

      {currentTab === 'script' && (
        <ScriptEditor pages={pages} onUpdatePages={setPages} onExit={() => setCurrentTab('studio')} />
      )}

      {currentTab === 'studio' && (
        <ThumbnailCarousel
          pages={pages}
          currentPageIndex={currentPageIndex}
          onSelectPage={idx => {
            setCurrentPageIndex(idx);
            setSelectedBubbleId(null);
          }}
          onDeletePage={id => {
            setPages(prev => prev.filter(p => p.id !== id));
            setCurrentPageIndex(prev => Math.max(0, prev - 1));
          }}
          onTranslateAllPages={handleTranslateAllPages}
          isBatchTranslating={isBatchTranslating}
          batchProgress={batchProgress}
          byokConfig={byokConfig}
        />
      )}

      {isDraggingFileOver && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-8 border-4 border-dashed border-orange-500 pointer-events-none">
          <UploadCloud className="w-20 h-20 text-orange-400 animate-bounce mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Drop Manga Pages or Chapters Here</h2>
          <p className="text-sm text-neutral-400">
            Accepts PNG, JPG, WEBP, ZIP, CBZ, and .yomi project archives
          </p>
        </div>
      )}

      <BYOKModal
        isOpen={showByokModal}
        onClose={() => setShowByokModal(false)}
        config={byokConfig}
        onSaveConfig={updateByokConfig}
      />

      <HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
      <ExtensionModal isOpen={showExtensionModal} onClose={() => setShowExtensionModal(false)} />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <MainRouter />
    </AuthProvider>
  );
}

export default App;
