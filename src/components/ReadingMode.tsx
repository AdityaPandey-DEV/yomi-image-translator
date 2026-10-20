import React, { useState } from 'react';
import { Eye, EyeOff, ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { PageImage } from '../types';
import { renderTextObject } from '../utils/typesetting';

interface ReadingModeProps {
  pages: PageImage[];
  onExitReader: () => void;
}

export const ReadingMode: React.FC<ReadingModeProps> = ({ pages, onExitReader }) => {
  const [showTranslations, setShowTranslations] = useState(true);
  const [zoomWidth, setZoomWidth] = useState<'fit' | 'wide' | 'full'>('fit');

  if (pages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-neutral-950 text-neutral-400">
        <p className="text-sm font-semibold">No manga pages loaded.</p>
        <button
          onClick={onExitReader}
          className="mt-3 px-4 py-2 rounded-lg text-xs bg-orange-500 text-white font-bold"
        >
          Return to Studio
        </button>
      </div>
    );
  }

  const getContainerWidthClass = () => {
    if (zoomWidth === 'fit') return 'max-w-3xl';
    if (zoomWidth === 'wide') return 'max-w-5xl';
    return 'max-w-none w-full';
  };

  return (
    <div className="flex-1 h-full bg-neutral-950 overflow-y-auto flex flex-col items-center select-none relative">
      {/* Floating Reader Top Toolbar */}
      <div className="sticky top-4 z-40 flex items-center gap-2 p-1.5 bg-neutral-900/90 backdrop-blur-md rounded-2xl border border-neutral-800 shadow-2xl">
        <button
          onClick={() => setShowTranslations(!showTranslations)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            showTranslations
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25'
              : 'bg-neutral-800 text-neutral-300'
          }`}
        >
          {showTranslations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          <span>{showTranslations ? 'Translations ON' : 'Raw Original'}</span>
        </button>

        <div className="w-px h-4 bg-neutral-800 mx-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoomWidth('fit')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
              zoomWidth === 'fit' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Fit
          </button>
          <button
            onClick={() => setZoomWidth('wide')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
              zoomWidth === 'wide' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Wide
          </button>
          <button
            onClick={() => setZoomWidth('full')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
              zoomWidth === 'full' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Full
          </button>
        </div>

        <div className="w-px h-4 bg-neutral-800 mx-1" />

        <button
          onClick={onExitReader}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
        >
          Exit Reader
        </button>
      </div>

      {/* Continuous Vertical Manga Chapter Scroll */}
      <div className={`w-full ${getContainerWidthClass()} py-8 space-y-6 px-4`}>
        {pages.map((page, index) => (
          <div
            key={page.id}
            className="relative bg-white rounded-xl shadow-2xl overflow-hidden border border-neutral-800/50"
          >
            <ReaderPageCanvas
              page={page}
              showTranslations={showTranslations}
            />
            {/* Page Floating Number */}
            <div className="absolute bottom-3 right-3 px-2 py-1 rounded-md bg-black/75 backdrop-blur-sm text-[11px] font-mono text-neutral-200">
              {index + 1} / {pages.length}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReaderPageCanvas: React.FC<{ page: PageImage; showTranslations: boolean }> = ({
  page,
  showTranslations,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, page.width, page.height);

      if (showTranslations) {
        page.textObjects.forEach(obj => {
          renderTextObject(ctx, obj, 1.0, false);
        });
      }
    };

    img.src = showTranslations && page.inpaintedSrc ? page.inpaintedSrc : page.originalSrc;
  }, [page, showTranslations]);

  return <canvas ref={canvasRef} className="w-full h-auto block" />;
};
