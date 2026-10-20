import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { InteractiveCanvas } from './components/InteractiveCanvas';
import { SidebarEditor } from './components/SidebarEditor';
import { ThumbnailCarousel } from './components/ThumbnailCarousel';
import { BYOKModal } from './components/BYOKModal';
import { HelpModal } from './components/HelpModal';
import { ExtensionModal } from './components/ExtensionModal';
import { ReadingMode } from './components/ReadingMode';
import { ScriptEditor } from './components/ScriptEditor';
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
import { UploadCloud, Sparkles, FolderArchive, ArrowRight } from 'lucide-react';

const DEFAULT_BYOK_CONFIG: BYOKConfig = {
  activeProvider: 'google',
  googleApiKey: '',
  googleModel: 'gemini-2.0-flash',
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

export function App() {
  // Theme & Modes
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentTab, setCurrentTab] = useState<'studio' | 'reader' | 'script'>('studio');
  const [viewMode, setViewMode] = useState<ViewMode>('translated');
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [brushSize, setBrushSize] = useState(16);

  // BYOK Configuration from localStorage
  const [byokConfig, setByokConfig] = useState<BYOKConfig>(() => {
    try {
      const saved = localStorage.getItem('yomi_byok_config');
      return saved ? { ...DEFAULT_BYOK_CONFIG, ...JSON.parse(saved) } : DEFAULT_BYOK_CONFIG;
    } catch {
      return DEFAULT_BYOK_CONFIG;
    }
  });

  // Pages & Navigation State
  const [pages, setPages] = useState<PageImage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);

  // Processing & Queue State
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBatchTranslating, setIsBatchTranslating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // Modals
  const [showByokModal, setShowByokModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [isDraggingFileOver, setIsDraggingFileOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentPage = pages[currentPageIndex] || null;
  const selectedBubble =
    currentPage?.textObjects.find(b => b.id === selectedBubbleId) || null;

  // Persist BYOK Config to localStorage
  const updateByokConfig = (updated: Partial<BYOKConfig>) => {
    setByokConfig(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('yomi_byok_config', JSON.stringify(next));
      return next;
    });
  };

  // Initial Auto-Load of Sample Manga Page on First Run
  useEffect(() => {
    const initSample = async () => {
      const sampleUrl = await createSampleShonenPage();
      const initialPage: PageImage = {
        id: `page-shonen-${Date.now()}`,
        filename: 'sample_shonen_chapter_01.png',
        originalSrc: sampleUrl,
        inpaintedSrc: null,
        textObjects: [],
        history: { past: [], future: [] },
        width: 900,
        height: 1350,
        status: 'idle',
        createdDate: Date.now(),
      };
      setPages([initialPage]);
    };
    initSample();
  }, []);

  // Quick Load Sample Manga
  const handleLoadSample = async (type: 'shonen' | 'romance') => {
    const dataUrl = type === 'shonen' ? await createSampleShonenPage() : await createSampleRomancePage();
    const newPage: PageImage = {
      id: `page-sample-${Date.now()}`,
      filename: `sample_${type}_page_${pages.length + 1}.png`,
      originalSrc: dataUrl,
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
    setSelectedBubbleId(null);
  };

  // Bubble Updates & Undo History Stack
  const pushHistory = useCallback(
    (pageId: string, currentBubbles: TextObject[]) => {
      setPages(prev =>
        prev.map(p => {
          if (p.id !== pageId) return p;
          const past = [...p.history.past, currentBubbles.map(b => ({ ...b }))];
          return {
            ...p,
            history: {
              past: past.slice(-30), // Retain last 30 undo steps
              future: [],
            },
          };
        })
      );
    },
    []
  );

  const handleUpdateBubble = useCallback(
    (updated: TextObject) => {
      if (!currentPage) return;
      pushHistory(currentPage.id, currentPage.textObjects);
      setPages(prev =>
        prev.map(p => {
          if (p.id !== currentPage.id) return p;
          return {
            ...p,
            textObjects: p.textObjects.map(b => (b.id === updated.id ? updated : b)),
          };
        })
      );
    },
    [currentPage, pushHistory]
  );

  const handleDeleteBubble = useCallback(
    (id: string) => {
      if (!currentPage) return;
      pushHistory(currentPage.id, currentPage.textObjects);
      setPages(prev =>
        prev.map(p => {
          if (p.id !== currentPage.id) return p;
          return {
            ...p,
            textObjects: p.textObjects.filter(b => b.id !== id),
          };
        })
      );
      if (selectedBubbleId === id) setSelectedBubbleId(null);
    },
    [currentPage, selectedBubbleId, pushHistory]
  );

  const handleDuplicateBubble = useCallback(
    (bubble: TextObject) => {
      if (!currentPage) return;
      const duplicated: TextObject = {
        ...bubble,
        id: `bubble-${Date.now()}`,
        x: bubble.x + 30,
        y: bubble.y + 30,
      };
      pushHistory(currentPage.id, currentPage.textObjects);
      setPages(prev =>
        prev.map(p => {
          if (p.id !== currentPage.id) return p;
          return { ...p, textObjects: [...p.textObjects, duplicated] };
        })
      );
      setSelectedBubbleId(duplicated.id);
    },
    [currentPage, pushHistory]
  );

  const handleAddBubble = useCallback(
    (x: number, y: number) => {
      if (!currentPage) return;
      const newBubble: TextObject = {
        id: `bubble-custom-${Date.now()}`,
        x,
        y,
        width: 140,
        height: 90,
        angle: 0,
        raw_text: '',
        text: 'NEW DIALOGUE',
        font: byokConfig.fontDefault || 'Comic Neue',
        fontSize: 18,
        autoFit: true,
        fontColor: '#000000',
        strokeColor: '#ffffff',
        strokeWidth: 3.5,
        strokeDisabled: !byokConfig.strokeEnabled,
        textAlign: 'center',
        vertical: false,
        uppercase: byokConfig.uppercaseDefault,
        lineHeight: 1.15,
      };
      pushHistory(currentPage.id, currentPage.textObjects);
      setPages(prev =>
        prev.map(p => {
          if (p.id !== currentPage.id) return p;
          return { ...p, textObjects: [...p.textObjects, newBubble] };
        })
      );
      setSelectedBubbleId(newBubble.id);
      setActiveTool('select');
    },
    [currentPage, byokConfig, pushHistory]
  );

  // Undo / Redo Handlers
  const handleUndo = useCallback(() => {
    if (!currentPage || currentPage.history.past.length === 0) return;
    const previous = currentPage.history.past[currentPage.history.past.length - 1];
    const newPast = currentPage.history.past.slice(0, -1);
    const newFuture = [currentPage.textObjects, ...currentPage.history.future];

    setPages(prev =>
      prev.map(p => {
        if (p.id !== currentPage.id) return p;
        return {
          ...p,
          textObjects: previous,
          history: { past: newPast, future: newFuture },
        };
      })
    );
  }, [currentPage]);

  const handleRedo = useCallback(() => {
    if (!currentPage || currentPage.history.future.length === 0) return;
    const next = currentPage.history.future[0];
    const newFuture = currentPage.history.future.slice(1);
    const newPast = [...currentPage.history.past, currentPage.textObjects];

    setPages(prev =>
      prev.map(p => {
        if (p.id !== currentPage.id) return p;
        return {
          ...p,
          textObjects: next,
          history: { past: newPast, future: newFuture },
        };
      })
    );
  }, [currentPage]);

  // Translate Single Page (Detection + OCR + Inpaint + Typeset)
  const translatePageAtIndex = async (index: number) => {
    const page = pages[index];
    if (!page) return;

    // Previous page narrative context memory
    const prevContext = index > 0 ? pages[index - 1].contextSummary || '' : '';

    setPages(prev =>
      prev.map((p, i) => (i === index ? { ...p, status: 'translating' } : p))
    );

    try {
      // 1. Detect Speech Bubbles & OCR & Translation
      const detection = await detectAndTranslateImage(page.originalSrc, byokConfig, prevContext);

      // 2. Erase Text Inside Detected Bubbles (Inpainting)
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

  // Erase & Inpaint Current Page Bubbles Only
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

  // Translate All Pages Batch Processor
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

  // File Upload Handlers (Images, ZIP, CBZ, .yomi)
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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBubbleId) {
          e.preventDefault();
          handleDeleteBubble(selectedBubbleId);
        }
      } else if (e.key === 'Escape') {
        setSelectedBubbleId(null);
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 'b' || e.key === 'B') {
        setActiveTool('bubble-add');
      } else if (e.key === 'h' || e.key === 'H') {
        setActiveTool('pan');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBubbleId, handleDeleteBubble, handleUndo, handleRedo]);

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
      {/* Hidden File Input */}
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

      {/* Top Application Header */}
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

      {/* Main Workspace Switcher */}
      {currentTab === 'studio' && (
        <main className="flex-1 flex overflow-hidden relative">
          <InteractiveCanvas
            currentPage={currentPage}
            selectedBubbleId={selectedBubbleId}
            onSelectBubble={setSelectedBubbleId}
            onUpdateBubble={handleUpdateBubble}
            onAddBubble={handleAddBubble}
            activeTool={activeTool}
            viewMode={viewMode}
            setViewMode={setViewMode}
            brushSize={brushSize}
            onCommitMaskStroke={() => {
              /* Inpaint mask stroke committed */
            }}
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
            onDuplicateBubble={handleDuplicateBubble}
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
        <ReadingMode
          pages={pages}
          onExitReader={() => setCurrentTab('studio')}
        />
      )}

      {currentTab === 'script' && (
        <ScriptEditor
          pages={pages}
          onUpdatePages={setPages}
          onExit={() => setCurrentTab('studio')}
        />
      )}

      {/* Bottom Chapter Thumbnail Carousel */}
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

      {/* Drag & Drop Visual Overlay */}
      {isDraggingFileOver && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-8 border-4 border-dashed border-orange-500 pointer-events-none">
          <UploadCloud className="w-20 h-20 text-orange-400 animate-bounce mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Drop Manga Pages or Chapters Here</h2>
          <p className="text-sm text-neutral-400">
            Accepts PNG, JPG, WEBP, ZIP, CBZ, and .yomi project archives
          </p>
        </div>
      )}

      {/* BYOK Keys Configuration Modal */}
      <BYOKModal
        isOpen={showByokModal}
        onClose={() => setShowByokModal(false)}
        config={byokConfig}
        onSaveConfig={updateByokConfig}
      />

      {/* Shortcuts & Documentation Modal */}
      <HelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />

      {/* Extension Installation Modal */}
      <ExtensionModal
        isOpen={showExtensionModal}
        onClose={() => setShowExtensionModal(false)}
      />
    </div>
  );
}

export default App;
