import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Split,
  Undo2,
  Redo2,
  Eraser,
  Paintbrush
} from 'lucide-react';
import { PageImage, TextObject, EditorTool, ViewMode } from '../types';
import { renderTextObject } from '../utils/typesetting';
import { applyBrush } from '../utils/inpainting';

interface InteractiveCanvasProps {
  currentPage: PageImage | null;
  selectedBubbleId: string | null;
  onSelectBubble: (id: string | null) => void;
  onUpdateBubble: (bubble: TextObject) => void;
  onAddBubble: (x: number, y: number) => void;
  activeTool: EditorTool;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  brushSize: number;
  onCommitMaskStroke: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
  currentPage,
  selectedBubbleId,
  onSelectBubble,
  onUpdateBubble,
  onAddBubble,
  activeTool,
  viewMode,
  setViewMode,
  brushSize,
  onCommitMaskStroke,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pan & Zoom Transform State
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Split Screen Comparison Slider Position (0.0 to 1.0)
  const [splitPosition, setSplitPosition] = useState(0.5);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  // Bubble Drag / Resize / Rotate State
  type DragMode = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | 'rotate' | null;
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [initialBubbleState, setInitialBubbleState] = useState<TextObject | null>(null);

  // Brush Painting State
  const [isPainting, setIsPainting] = useState(false);
  const [lastPaintPos, setLastPaintPos] = useState({ x: 0, y: 0 });

  // Cached image elements
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const inpaintedImgRef = useRef<HTMLImageElement | null>(null);

  // Initialize and load images
  useEffect(() => {
    if (!currentPage) return;

    const orig = new Image();
    orig.crossOrigin = 'anonymous';
    orig.onload = () => {
      originalImgRef.current = orig;
      render();
    };
    orig.src = currentPage.originalSrc;

    if (currentPage.inpaintedSrc) {
      const inp = new Image();
      inp.crossOrigin = 'anonymous';
      inp.onload = () => {
        inpaintedImgRef.current = inp;
        render();
      };
      inp.src = currentPage.inpaintedSrc;
    } else {
      inpaintedImgRef.current = null;
    }

    // Initialize or resize mask canvas
    if (!maskCanvasRef.current) {
      maskCanvasRef.current = document.createElement('canvas');
    }
    maskCanvasRef.current.width = currentPage.width;
    maskCanvasRef.current.height = currentPage.height;
    const mctx = maskCanvasRef.current.getContext('2d');
    if (mctx) mctx.clearRect(0, 0, currentPage.width, currentPage.height);

    // Auto-fit page on initial load
    handleFitToScreen();
  }, [currentPage?.id]);

  // Re-render when dependencies change
  useEffect(() => {
    render();
  }, [
    currentPage,
    zoom,
    pan,
    selectedBubbleId,
    viewMode,
    splitPosition,
    dragMode,
  ]);

  const handleFitToScreen = useCallback(() => {
    if (!containerRef.current || !currentPage) return;
    const cw = containerRef.current.clientWidth - 40;
    const ch = containerRef.current.clientHeight - 40;
    const scale = Math.min(cw / currentPage.width, ch / currentPage.height, 1.5);
    setZoom(scale);
    setPan({
      x: (containerRef.current.clientWidth - currentPage.width * scale) / 2,
      y: (containerRef.current.clientHeight - currentPage.height * scale) / 2,
    });
  }, [currentPage]);

  // Coordinate Conversion: Screen/DOM pixels -> Manga image pixels
  const screenToImageCoords = (screenX: number, screenY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (screenX - rect.left - pan.x) / zoom;
    const y = (screenY - rect.top - pan.y) / zoom;
    return { x, y };
  };

  // Main Canvas Render Loop
  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPage || !containerRef.current) return;

    canvas.width = containerRef.current.clientWidth;
    canvas.height = containerRef.current.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Apply Pan & Zoom Transform
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Manga Page Border Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 24 / zoom;
    ctx.shadowOffsetY = 8 / zoom;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, currentPage.width, currentPage.height);
    ctx.restore();

    const origImg = originalImgRef.current;
    const inpImg = inpaintedImgRef.current || origImg;

    // View Mode Rendering
    if (viewMode === 'original' && origImg) {
      // 1. Raw Original scan
      ctx.drawImage(origImg, 0, 0, currentPage.width, currentPage.height);
    } else if (viewMode === 'inpainted' && inpImg) {
      // 2. Pure artwork without text
      ctx.drawImage(inpImg, 0, 0, currentPage.width, currentPage.height);
    } else if (viewMode === 'split' && origImg) {
      // 3. Interactive Split Comparison Slider
      const splitX = currentPage.width * splitPosition;

      // Draw Left Side: Original
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, currentPage.height);
      ctx.clip();
      ctx.drawImage(origImg, 0, 0, currentPage.width, currentPage.height);
      ctx.restore();

      // Draw Right Side: Inpainted + Translated
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, currentPage.width - splitX, currentPage.height);
      ctx.clip();
      if (inpImg) ctx.drawImage(inpImg, 0, 0, currentPage.width, currentPage.height);
      currentPage.textObjects.forEach(obj => {
        renderTextObject(ctx, obj, 1.0, obj.id === selectedBubbleId);
      });
      ctx.restore();

      // Draw Split Divider Line
      ctx.save();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.5 / zoom;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6 / zoom;
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, currentPage.height);
      ctx.stroke();

      // Draw Split Handle in Center
      const handleY = currentPage.height * 0.5;
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(splitX, handleY, 14 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / zoom;
      ctx.stroke();
      ctx.restore();
    } else {
      // 4. Default: Translated View (Inpainted + Typeset Text)
      if (inpImg) {
        ctx.drawImage(inpImg, 0, 0, currentPage.width, currentPage.height);
      } else if (origImg) {
        ctx.drawImage(origImg, 0, 0, currentPage.width, currentPage.height);
      }

      // Render Inpaint Mask Layer (if any manual brush strokes exist)
      if (maskCanvasRef.current) {
        ctx.drawImage(maskCanvasRef.current, 0, 0);
      }

      // Render All Speech Bubble Text Objects
      currentPage.textObjects.forEach(obj => {
        renderTextObject(ctx, obj, 1.0, obj.id === selectedBubbleId);
      });
    }

    ctx.restore();
  };

  // Mouse / Touch Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!currentPage) return;
    const { x: imgX, y: imgY } = screenToImageCoords(e.clientX, e.clientY);

    // 1. Check Split Screen Slider Handle Drag
    if (viewMode === 'split') {
      const splitX = currentPage.width * splitPosition;
      if (Math.abs(imgX - splitX) < 20 / zoom) {
        setIsDraggingSplit(true);
        return;
      }
    }

    // 2. Handle Middle Mouse Button, Shift-Drag or Pan Tool
    if (activeTool === 'pan' || e.button === 1 || e.shiftKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // 3. Handle Manual Brush or Eraser Tool
    if (activeTool === 'brush' || activeTool === 'eraser') {
      setIsPainting(true);
      setLastPaintPos({ x: imgX, y: imgY });
      if (maskCanvasRef.current) {
        const mctx = maskCanvasRef.current.getContext('2d');
        if (mctx) {
          applyBrush(
            mctx,
            imgX,
            imgY,
            imgX,
            imgY,
            brushSize / 2,
            '#ffffff',
            activeTool === 'eraser'
          );
          render();
        }
      }
      return;
    }

    // 4. Handle "Add Bubble" Tool
    if (activeTool === 'bubble-add') {
      onAddBubble(Math.round(imgX), Math.round(imgY));
      return;
    }

    // 5. Select or Transform Speech Bubble
    const clickedBubble = [...currentPage.textObjects]
      .reverse()
      .find(b => {
        return (
          imgX >= b.x - b.width / 2 &&
          imgX <= b.x + b.width / 2 &&
          imgY >= b.y - b.height / 2 &&
          imgY <= b.y + b.height / 2
        );
      });

    if (clickedBubble) {
      onSelectBubble(clickedBubble.id);
      setDragMode('move');
      setDragStartPos({ x: imgX, y: imgY });
      setInitialBubbleState({ ...clickedBubble });
    } else {
      onSelectBubble(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!currentPage) return;
    const { x: imgX, y: imgY } = screenToImageCoords(e.clientX, e.clientY);

    // 1. Dragging Split Slider
    if (isDraggingSplit) {
      const newPos = Math.max(0.05, Math.min(0.95, imgX / currentPage.width));
      setSplitPosition(newPos);
      return;
    }

    // 2. Panning
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    // 3. Brush / Eraser Painting
    if (isPainting && (activeTool === 'brush' || activeTool === 'eraser')) {
      if (maskCanvasRef.current) {
        const mctx = maskCanvasRef.current.getContext('2d');
        if (mctx) {
          applyBrush(
            mctx,
            lastPaintPos.x,
            lastPaintPos.y,
            imgX,
            imgY,
            brushSize / 2,
            '#ffffff',
            activeTool === 'eraser'
          );
          setLastPaintPos({ x: imgX, y: imgY });
          render();
        }
      }
      return;
    }

    // 4. Bubble Dragging / Moving
    if (dragMode === 'move' && initialBubbleState) {
      const dx = imgX - dragStartPos.x;
      const dy = imgY - dragStartPos.y;

      onUpdateBubble({
        ...initialBubbleState,
        x: Math.round(initialBubbleState.x + dx),
        y: Math.round(initialBubbleState.y + dy),
      });
    }
  };

  const handleMouseUp = () => {
    if (isDraggingSplit) setIsDraggingSplit(false);
    if (isPanning) setIsPanning(false);
    if (isPainting) {
      setIsPainting(false);
      onCommitMaskStroke();
    }
    if (dragMode) setDragMode(null);
  };

  // Zoom with Mouse Wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.15), 5.0);

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom towards mouse cursor point
    const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
    const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 h-full bg-neutral-950 overflow-hidden select-none cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* View Mode Switcher Toolbar */}
      <div className="absolute top-4 left-4 z-20 flex items-center p-1 bg-neutral-900/90 backdrop-blur-md rounded-xl border border-neutral-800 shadow-xl">
        <button
          onClick={() => setViewMode('translated')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === 'translated'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Translated
        </button>
        <button
          onClick={() => setViewMode('split')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === 'split'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Split className="w-3.5 h-3.5" />
          Split Compare
        </button>
        <button
          onClick={() => setViewMode('inpainted')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === 'inpainted'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Clean Artwork
        </button>
        <button
          onClick={() => setViewMode('original')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === 'original'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Original Scan
        </button>
      </div>

      {/* Floating Canvas Zoom & History Controls */}
      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-1.5 p-1 bg-neutral-900/90 backdrop-blur-md rounded-xl border border-neutral-800 shadow-xl">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 rounded-lg text-neutral-300 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-300 transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 rounded-lg text-neutral-300 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-300 transition-colors"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-neutral-800 mx-1" />

        <button
          onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))}
          className="p-2 rounded-lg text-neutral-300 hover:text-white transition-colors"
          title="Zoom Out (-)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <span className="text-xs font-mono font-medium text-neutral-400 px-2 min-w-[3.5rem] text-center">
          {Math.round(zoom * 100)}%
        </span>

        <button
          onClick={() => setZoom(z => Math.min(z * 1.25, 4.0))}
          className="p-2 rounded-lg text-neutral-300 hover:text-white transition-colors"
          title="Zoom In (+)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          onClick={handleFitToScreen}
          className="p-2 rounded-lg text-neutral-300 hover:text-white transition-colors"
          title="Fit to Window"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
