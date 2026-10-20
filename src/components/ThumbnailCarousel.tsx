import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Download,
  Trash2,
  FileArchive,
  FileText,
  FileCode,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { PageImage, BYOKConfig } from '../types';
import {
  exportSinglePage,
  exportAllPagesAsZip,
  exportAllPagesAsPdf,
  exportYomiProject,
  exportDialogueScript
} from '../utils/fileIo';

interface ThumbnailCarouselProps {
  pages: PageImage[];
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onDeletePage: (id: string) => void;
  onTranslateAllPages: () => void;
  isBatchTranslating: boolean;
  batchProgress: { current: number; total: number };
  byokConfig: BYOKConfig;
}

export const ThumbnailCarousel: React.FC<ThumbnailCarouselProps> = ({
  pages,
  currentPageIndex,
  onSelectPage,
  onDeletePage,
  onTranslateAllPages,
  isBatchTranslating,
  batchProgress,
  byokConfig,
}) => {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const currentPage = pages[currentPageIndex] || null;

  if (pages.length === 0) return null;

  return (
    <div className="h-28 border-t border-neutral-800 bg-neutral-950/95 flex items-center px-4 gap-4 select-none z-20 shrink-0">
      {/* 1. Batch Progress / Action Controls */}
      <div className="flex flex-col gap-2 shrink-0 pr-4 border-r border-neutral-800">
        <button
          onClick={onTranslateAllPages}
          disabled={isBatchTranslating}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white shadow-md shadow-orange-500/25 transition-all cursor-pointer whitespace-nowrap"
        >
          {isBatchTranslating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>
            {isBatchTranslating
              ? `Translating (${batchProgress.current}/${batchProgress.total})`
              : `Translate All (${pages.length})`}
          </span>
        </button>

        {/* Export Dropdown Menu */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-800 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-orange-400" />
              Export
            </span>
            <span className="text-[10px] text-neutral-400">▼</span>
          </button>

          {showExportMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowExportMenu(false)}
              />
              <div className="absolute bottom-full left-0 mb-2 w-56 p-1.5 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 flex flex-col gap-1">
                <button
                  onClick={() => {
                    if (currentPage) exportSinglePage(currentPage, 'png');
                    setShowExportMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 text-left transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-orange-400" />
                  <span>Current Page (PNG)</span>
                </button>

                <button
                  onClick={() => {
                    exportAllPagesAsZip(pages);
                    setShowExportMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 text-left transition-colors"
                >
                  <FileArchive className="w-4 h-4 text-amber-400" />
                  <span>All Pages as ZIP</span>
                </button>

                <button
                  onClick={() => {
                    exportAllPagesAsPdf(pages);
                    setShowExportMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 text-left transition-colors"
                >
                  <FileText className="w-4 h-4 text-red-400" />
                  <span>Chapter as PDF</span>
                </button>

                <div className="h-px bg-neutral-800 my-0.5" />

                <button
                  onClick={() => {
                    exportYomiProject(pages, byokConfig);
                    setShowExportMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 text-left transition-colors"
                >
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span>Yomi Project (.yomi)</span>
                </button>

                <button
                  onClick={() => {
                    exportDialogueScript(pages);
                    setShowExportMenu(false);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-neutral-200 hover:bg-neutral-800 text-left transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span>Dialogue Script (.txt)</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 2. Navigation Arrow: Prev */}
      <button
        onClick={() => onSelectPage(Math.max(0, currentPageIndex - 1))}
        disabled={currentPageIndex === 0}
        className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors shrink-0"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* 3. Horizontal Scrollable Page Thumbnails */}
      <div className="flex-1 flex items-center gap-3 overflow-x-auto py-2 scrollbar-thin">
        {pages.map((page, idx) => {
          const isSelected = idx === currentPageIndex;
          const isTranslated = page.textObjects.length > 0;

          return (
            <div
              key={page.id}
              onClick={() => onSelectPage(idx)}
              className={`relative group shrink-0 h-20 w-16 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                isSelected
                  ? 'border-orange-500 scale-105 shadow-lg shadow-orange-500/20'
                  : 'border-neutral-800 hover:border-neutral-700 opacity-70 hover:opacity-100'
              }`}
            >
              <img
                src={page.inpaintedSrc || page.originalSrc}
                alt={page.filename}
                className="w-full h-full object-cover"
              />

              {/* Page Number Badge */}
              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-neutral-900/80 text-neutral-200">
                P.{idx + 1}
              </span>

              {/* Status Indicator Badge */}
              <div className="absolute top-1 right-1">
                {page.status === 'translating' ? (
                  <Loader2 className="w-3.5 h-3.5 text-orange-400 animate-spin" />
                ) : isTranslated ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 fill-neutral-900" />
                ) : null}
              </div>

              {/* Delete Page Button */}
              {pages.length > 1 && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDeletePage(page.id);
                  }}
                  className="absolute top-1 left-1 p-1 rounded bg-black/60 text-neutral-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove page"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 4. Navigation Arrow: Next */}
      <button
        onClick={() => onSelectPage(Math.min(pages.length - 1, currentPageIndex + 1))}
        disabled={currentPageIndex >= pages.length - 1}
        className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors shrink-0"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
};
