import React from 'react';
import { X, Keyboard, MousePointer, Sparkles, BookOpen } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'V', desc: 'Select / Move Bubble tool' },
    { key: 'B', desc: 'Add new Speech Bubble' },
    { key: 'H / Space + Drag', desc: 'Pan canvas' },
    { key: 'Scroll Wheel', desc: 'Zoom in and out (centered at cursor)' },
    { key: 'Ctrl / Cmd + Z', desc: 'Undo last stroke or change' },
    { key: 'Ctrl / Cmd + Y', desc: 'Redo' },
    { key: 'Delete / Backspace', desc: 'Delete selected speech bubble' },
    { key: 'Escape', desc: 'Deselect bubble' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-bold text-neutral-100">Yomi Shortcuts & Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Keyboard Shortcuts List */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">
              Keyboard Shortcuts
            </h3>
            <div className="bg-neutral-950 rounded-xl border border-neutral-800 divide-y divide-neutral-800/80">
              {shortcuts.map(s => (
                <div key={s.key} className="px-3.5 py-2 flex items-center justify-between text-xs">
                  <span className="font-mono px-2 py-0.5 rounded bg-neutral-800 text-orange-400 font-semibold border border-neutral-700">
                    {s.key}
                  </span>
                  <span className="text-neutral-300">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Core Features Quick Tour */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Pro Workflow Tips
            </h3>

            <div className="p-3 bg-neutral-950/80 rounded-xl border border-neutral-800 flex gap-3 text-xs">
              <Sparkles className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-neutral-200 block">Interactive Split Slider</strong>
                <p className="text-neutral-400 text-[11px] mt-0.5">
                  Click 'Split Compare' on top of the canvas and drag the orange handle across the page to compare original raw Japanese against translated English in real time.
                </p>
              </div>
            </div>

            <div className="p-3 bg-neutral-950/80 rounded-xl border border-neutral-800 flex gap-3 text-xs">
              <MousePointer className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-neutral-200 block">Comic Auto-Fitting</strong>
                <p className="text-neutral-400 text-[11px] mt-0.5">
                  Yomi automatically solves the optimal font size to fit any text length inside the bubble contour without overflowing, preserving hyphenation and punctuation safety.
                </p>
              </div>
            </div>

            <div className="p-3 bg-neutral-950/80 rounded-xl border border-neutral-800 flex gap-3 text-xs">
              <BookOpen className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-neutral-200 block">Batch Chapters & Project Files</strong>
                <p className="text-neutral-400 text-[11px] mt-0.5">
                  Drag whole ZIP, CBZ, or PDF archives to load all pages. Save as <code className="text-orange-400">.yomi</code> project file to preserve all editable vector bubbles and resume work anytime.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-950/80 text-right">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
