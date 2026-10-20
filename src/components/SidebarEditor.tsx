import React from 'react';
import {
  MousePointer,
  MessageSquarePlus,
  Paintbrush,
  Eraser,
  Hand,
  Trash2,
  Copy,
  Sparkles,
  Wand2,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RotateCw,
  Palette
} from 'lucide-react';
import { TextObject, EditorTool, PageImage, BYOKConfig } from '../types';

interface SidebarEditorProps {
  currentPage: PageImage | null;
  selectedBubble: TextObject | null;
  onUpdateBubble: (bubble: TextObject) => void;
  onDeleteBubble: (id: string) => void;
  onDuplicateBubble: (bubble: TextObject) => void;
  onAddBubbleClick: () => void;
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  byokConfig: BYOKConfig;
  onUpdateConfig: (config: Partial<BYOKConfig>) => void;
  onTranslateCurrentPage: () => void;
  onInpaintCurrentPage: () => void;
  isProcessing: boolean;
}

export const SidebarEditor: React.FC<SidebarEditorProps> = ({
  currentPage,
  selectedBubble,
  onUpdateBubble,
  onDeleteBubble,
  onDuplicateBubble,
  onAddBubbleClick,
  activeTool,
  setActiveTool,
  brushSize,
  setBrushSize,
  byokConfig,
  onUpdateConfig,
  onTranslateCurrentPage,
  onInpaintCurrentPage,
  isProcessing,
}) => {
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish (Español)' },
    { code: 'fr', name: 'French (Français)' },
    { code: 'de', name: 'German (Deutsch)' },
    { code: 'it', name: 'Italian (Italiano)' },
    { code: 'pt', name: 'Portuguese (Português)' },
    { code: 'ru', name: 'Russian (Русский)' },
    { code: 'ja', name: 'Japanese (日本語)' },
    { code: 'ko', name: 'Korean (한국어)' },
    { code: 'zh', name: 'Chinese (中文)' },
    { code: 'id', name: 'Indonesian (Bahasa)' },
    { code: 'vi', name: 'Vietnamese (Tiếng Việt)' },
    { code: 'th', name: 'Thai (ไทย)' },
    { code: 'ar', name: 'Arabic (العربية)' },
    { code: 'hi', name: 'Hindi (हिन्दी)' },
  ];

  const fonts = [
    { id: 'Comic Neue', name: 'Comic Neue (Classic Manga)' },
    { id: 'Bangers', name: 'Bangers (Shonen Action/SFX)' },
    { id: 'Noto Sans JP', name: 'Noto Sans (Clean Modern)' },
    { id: 'Permanent Marker', name: 'Marker (Rough Shout)' },
    { id: 'sans-serif', name: 'System Sans-Serif' },
    { id: 'serif', name: 'Traditional Serif' },
  ];

  return (
    <aside className="w-80 border-l border-neutral-800 bg-neutral-950/95 flex flex-col h-full overflow-y-auto select-none z-20 shrink-0">
      {/* 1. Tool Selection Grid */}
      <div className="p-4 border-b border-neutral-800">
        <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">
          Editor Tools
        </label>
        <div className="grid grid-cols-5 gap-1.5 p-1 bg-neutral-900 rounded-xl border border-neutral-800">
          <button
            onClick={() => setActiveTool('select')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeTool === 'select'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Select & Move Bubble (V)"
          >
            <MousePointer className="w-4 h-4" />
            <span className="text-[10px] font-semibold">Select</span>
          </button>

          <button
            onClick={() => {
              setActiveTool('bubble-add');
              onAddBubbleClick();
            }}
            className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeTool === 'bubble-add'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Create Speech Bubble (B)"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span className="text-[10px] font-semibold">+ Bubble</span>
          </button>

          <button
            onClick={() => setActiveTool('brush')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeTool === 'brush'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Manual Inpaint Brush"
          >
            <Paintbrush className="w-4 h-4" />
            <span className="text-[10px] font-semibold">Brush</span>
          </button>

          <button
            onClick={() => setActiveTool('eraser')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeTool === 'eraser'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Mask Eraser"
          >
            <Eraser className="w-4 h-4" />
            <span className="text-[10px] font-semibold">Eraser</span>
          </button>

          <button
            onClick={() => setActiveTool('pan')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeTool === 'pan'
                ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Pan Hand Tool (H / Space)"
          >
            <Hand className="w-4 h-4" />
            <span className="text-[10px] font-semibold">Pan</span>
          </button>
        </div>

        {/* Brush Size Slider (shown when brush or eraser is active) */}
        {(activeTool === 'brush' || activeTool === 'eraser') && (
          <div className="mt-3 p-2.5 bg-neutral-900 rounded-lg border border-neutral-800 flex items-center gap-3">
            <span className="text-xs text-neutral-400 font-medium">Size:</span>
            <input
              type="range"
              min="4"
              max="64"
              value={brushSize}
              onChange={e => setBrushSize(Number(e.target.value))}
              className="flex-1 accent-orange-500 cursor-pointer"
            />
            <span className="text-xs font-mono text-neutral-200 w-8 text-right">{brushSize}px</span>
          </div>
        )}
      </div>

      {/* 2. Primary Page AI Translation Actions */}
      <div className="p-4 border-b border-neutral-800 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            Page Translation
          </label>
          <span className="text-[11px] text-orange-400 font-mono">
            {currentPage?.textObjects.length || 0} Bubbles
          </span>
        </div>

        {/* Target Language Dropdown */}
        <div>
          <label className="text-xs text-neutral-400 block mb-1">Target Language</label>
          <select
            value={byokConfig.targetLanguage}
            onChange={e => onUpdateConfig({ targetLanguage: e.target.value })}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onTranslateCurrentPage}
            disabled={isProcessing || !currentPage}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isProcessing ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Translate Page
          </button>

          <button
            onClick={onInpaintCurrentPage}
            disabled={isProcessing || !currentPage}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 disabled:opacity-50 transition-colors cursor-pointer"
            title="Erase text from speech bubbles"
          >
            <Wand2 className="w-3.5 h-3.5 text-orange-400" />
            Inpaint
          </button>
        </div>
      </div>

      {/* 3. Selected Speech Bubble Inspector & Typesetting */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {selectedBubble ? (
          <>
            <div className="flex items-center justify-between pb-1 border-b border-neutral-800">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5" />
                Bubble Typography
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onDuplicateBubble(selectedBubble)}
                  className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  title="Duplicate Bubble"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDeleteBubble(selectedBubble.id)}
                  className="p-1.5 rounded hover:bg-red-950/40 text-neutral-400 hover:text-red-400"
                  title="Delete Bubble"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Translated Text Editor */}
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Translated Dialogue</label>
              <textarea
                value={selectedBubble.text}
                onChange={e => onUpdateBubble({ ...selectedBubble, text: e.target.value })}
                rows={3}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-100 font-medium focus:outline-none focus:border-orange-500 resize-y"
                placeholder="Enter translated dialogue..."
              />
            </div>

            {/* Original OCR Text (if present) */}
            {selectedBubble.raw_text && (
              <div className="p-2 bg-neutral-900/60 rounded-lg border border-neutral-800/80">
                <span className="text-[10px] text-neutral-500 font-semibold block mb-0.5">
                  Original Detected Text:
                </span>
                <span className="text-xs font-japanese text-neutral-300">
                  {selectedBubble.raw_text}
                </span>
              </div>
            )}

            {/* Font Family */}
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Comic Font</label>
              <select
                value={selectedBubble.font}
                onChange={e => onUpdateBubble({ ...selectedBubble, font: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-orange-500"
              >
                {fonts.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Sizing: Auto-Fit vs Manual */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-neutral-400">Auto-Fit to Bubble</label>
                <input
                  type="checkbox"
                  checked={selectedBubble.autoFit}
                  onChange={e => onUpdateBubble({ ...selectedBubble, autoFit: e.target.checked })}
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>

              {!selectedBubble.autoFit && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400">Size:</span>
                  <input
                    type="range"
                    min="10"
                    max="64"
                    value={selectedBubble.fontSize}
                    onChange={e =>
                      onUpdateBubble({ ...selectedBubble, fontSize: Number(e.target.value) })
                    }
                    className="flex-1 accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-neutral-300 w-8 text-right">
                    {selectedBubble.fontSize}px
                  </span>
                </div>
              )}
            </div>

            {/* Text Alignment */}
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Alignment</label>
              <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => onUpdateBubble({ ...selectedBubble, textAlign: align })}
                    className={`flex-1 py-1 rounded flex justify-center transition-colors ${
                      selectedBubble.textAlign === align
                        ? 'bg-orange-500 text-white'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {align === 'left' && <AlignLeft className="w-3.5 h-3.5" />}
                    {align === 'center' && <AlignCenter className="w-3.5 h-3.5" />}
                    {align === 'right' && <AlignRight className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Outline / Stroke Halo */}
            <div className="space-y-2 p-2.5 bg-neutral-900/50 rounded-lg border border-neutral-800">
              <div className="flex items-center justify-between">
                <label className="text-xs text-neutral-300 font-medium">Text Outline Halo</label>
                <input
                  type="checkbox"
                  checked={!selectedBubble.strokeDisabled}
                  onChange={e =>
                    onUpdateBubble({ ...selectedBubble, strokeDisabled: !e.target.checked })
                  }
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>

              {!selectedBubble.strokeDisabled && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400">Width:</span>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="0.5"
                    value={selectedBubble.strokeWidth}
                    onChange={e =>
                      onUpdateBubble({ ...selectedBubble, strokeWidth: Number(e.target.value) })
                    }
                    className="flex-1 accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-neutral-300 w-8 text-right">
                    {selectedBubble.strokeWidth}
                  </span>
                </div>
              )}
            </div>

            {/* Lettering Formatting Toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-neutral-400">UPPERCASE Comic Dialogue</label>
                <input
                  type="checkbox"
                  checked={selectedBubble.uppercase}
                  onChange={e =>
                    onUpdateBubble({ ...selectedBubble, uppercase: e.target.checked })
                  }
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-neutral-400">Vertical Typesetting (CJK)</label>
                <input
                  type="checkbox"
                  checked={selectedBubble.vertical}
                  onChange={e =>
                    onUpdateBubble({ ...selectedBubble, vertical: e.target.checked })
                  }
                  className="accent-orange-500 rounded cursor-pointer"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-500">
            <MessageSquarePlus className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-xs font-semibold text-neutral-400">No Speech Bubble Selected</p>
            <p className="text-[11px] text-neutral-500 mt-1 max-w-[180px]">
              Click any bubble on the page to adjust text, comic fonts, and halo stroke, or click "+ Bubble" to create one.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};
