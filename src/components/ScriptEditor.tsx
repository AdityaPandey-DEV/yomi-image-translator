import React, { useState } from 'react';
import { Search, Replace, Save, Download, FileText, Check } from 'lucide-react';
import { PageImage, TextObject } from '../types';
import { exportDialogueScript } from '../utils/fileIo';

interface ScriptEditorProps {
  pages: PageImage[];
  onUpdatePages: (updated: PageImage[]) => void;
  onExit: () => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  pages,
  onUpdatePages,
  onExit,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  // Local editable copy
  const [editedPages, setEditedPages] = useState<PageImage[]>(() =>
    JSON.parse(JSON.stringify(pages))
  );

  const handleTextChange = (pageIndex: number, bubbleIndex: number, newText: string) => {
    setEditedPages(prev => {
      const copy = [...prev];
      copy[pageIndex].textObjects[bubbleIndex].text = newText;
      return copy;
    });
  };

  const handleGlobalReplace = () => {
    if (!searchTerm) return;
    setEditedPages(prev => {
      return prev.map(page => ({
        ...page,
        textObjects: page.textObjects.map(bubble => ({
          ...bubble,
          text: bubble.text.replaceAll(searchTerm, replaceTerm),
        })),
      }));
    });
  };

  const handleApplyChanges = () => {
    onUpdatePages(editedPages);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1500);
  };

  return (
    <div className="flex-1 h-full bg-neutral-950 flex flex-col overflow-hidden select-none">
      {/* Script Toolbar */}
      <div className="h-14 border-b border-neutral-800 bg-neutral-900/60 px-6 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-orange-400" />
          <h2 className="text-sm font-bold text-neutral-100">Chapter Dialogue & Script Studio</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
            {editedPages.reduce((acc, p) => acc + p.textObjects.length, 0)} Total Bubbles
          </span>
        </div>

        {/* Global Find and Replace Bar */}
        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Find term..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-orange-500 w-36"
            />
          </div>
          <div className="relative">
            <Replace className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Replace with..."
              value={replaceTerm}
              onChange={e => setReplaceTerm(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-orange-500 w-36"
            />
          </div>
          <button
            onClick={handleGlobalReplace}
            disabled={!searchTerm}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 disabled:opacity-40 transition-colors"
          >
            Replace All
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportDialogueScript(editedPages)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800"
          >
            <Download className="w-3.5 h-3.5" />
            Export .txt
          </button>

          <button
            onClick={handleApplyChanges}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/25 transition-all"
          >
            {savedNotice ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {savedNotice ? 'Applied to Canvas!' : 'Apply to Canvas'}
          </button>

          <button
            onClick={onExit}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>

      {/* Script Entries Table */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {editedPages.map((page, pIdx) => (
          <div
            key={page.id}
            className="bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden shadow-xl"
          >
            {/* Page Header */}
            <div className="bg-neutral-900 px-4 py-2.5 border-b border-neutral-800 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-200">
                Page {pIdx + 1}: {page.filename}
              </span>
              <span className="text-[11px] font-mono text-neutral-400">
                {page.textObjects.length} dialogue lines
              </span>
            </div>

            {/* Bubble List */}
            <div className="divide-y divide-neutral-800/60">
              {page.textObjects.length > 0 ? (
                page.textObjects.map((bubble, bIdx) => (
                  <div key={bubble.id} className="p-3.5 flex flex-col sm:flex-row gap-4 items-start">
                    <span className="px-2 py-1 rounded bg-neutral-800 font-mono text-[10px] text-orange-400 font-bold shrink-0">
                      Bubble #{bIdx + 1}
                    </span>

                    {/* Original OCR Text */}
                    <div className="sm:w-1/3 min-w-[200px]">
                      <span className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                        Raw Foreign Text
                      </span>
                      <p className="text-xs font-japanese text-neutral-400 bg-neutral-950 p-2 rounded-lg border border-neutral-800/80">
                        {bubble.raw_text || '(Not detected / Added manually)'}
                      </p>
                    </div>

                    {/* Translated Text (Editable) */}
                    <div className="flex-1 w-full">
                      <span className="text-[10px] text-neutral-500 uppercase font-bold block mb-1">
                        Translated Manga Dialogue
                      </span>
                      <textarea
                        value={bubble.text}
                        onChange={e => handleTextChange(pIdx, bIdx, e.target.value)}
                        rows={2}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-xs text-neutral-100 font-medium focus:outline-none focus:border-orange-500 resize-y"
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-neutral-500">
                  No dialogue text detected on this page.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
