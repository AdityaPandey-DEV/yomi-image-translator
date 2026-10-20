// Reverse-Engineered Inpainting & Bubble Eraser Engine (Yomi Translator)
import { TextObject } from '../types';

/**
 * Clean speech bubbles in a manga image by erasing the dark text while preserving
 * speech bubble outlines, artwork, and background tone.
 */
export async function inpaintAllBubbles(
  imgElement: HTMLImageElement,
  textObjects: TextObject[],
  inpaintMultiplier = 1.15
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = imgElement.naturalWidth || imgElement.width;
  canvas.height = imgElement.naturalHeight || imgElement.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return imgElement.src;

  // Draw original base image
  ctx.drawImage(imgElement, 0, 0);

  // If no bubbles to inpaint, return original
  if (!textObjects || textObjects.length === 0) {
    return canvas.toDataURL('image/png');
  }

  // Process each bubble
  for (const bubble of textObjects) {
    cleanSingleBubble(ctx, bubble, inpaintMultiplier);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Erases text inside a specific bubble bounding box using adaptive thresholding
 * and surrounding color sampling.
 */
export function cleanSingleBubble(
  ctx: CanvasRenderingContext2D,
  bubble: TextObject,
  multiplier = 1.15
) {
  const padW = bubble.width * multiplier;
  const padH = bubble.height * multiplier;

  const startX = Math.max(0, Math.floor(bubble.x - padW / 2));
  const startY = Math.max(0, Math.floor(bubble.y - padH / 2));
  const width = Math.min(ctx.canvas.width - startX, Math.ceil(padW));
  const height = Math.min(ctx.canvas.height - startY, Math.ceil(padH));

  if (width <= 0 || height <= 0) return;

  const imgData = ctx.getImageData(startX, startY, width, height);
  const data = imgData.data;

  // 1. Sample perimeter border pixels to determine the bubble's background color
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let sampleCount = 0;

  // Sample top and bottom borders
  for (let x = 0; x < width; x += 2) {
    const topIdx = (0 * width + x) * 4;
    const botIdx = ((height - 1) * width + x) * 4;

    bgR += data[topIdx] + data[botIdx];
    bgG += data[topIdx + 1] + data[botIdx + 1];
    bgB += data[topIdx + 2] + data[botIdx + 2];
    sampleCount += 2;
  }

  // Sample left and right borders
  for (let y = 0; y < height; y += 2) {
    const leftIdx = (y * width + 0) * 4;
    const rightIdx = (y * width + (width - 1)) * 4;

    bgR += data[leftIdx] + data[rightIdx];
    bgG += data[leftIdx + 1] + data[rightIdx + 1];
    bgB += data[leftIdx + 2] + data[rightIdx + 2];
    sampleCount += 2;
  }

  if (sampleCount > 0) {
    bgR = Math.round(bgR / sampleCount);
    bgG = Math.round(bgG / sampleCount);
    bgB = Math.round(bgB / sampleCount);
  } else {
    bgR = 255;
    bgG = 255;
    bgB = 255;
  }

  // Manga bubbles are overwhelmingly white or near-white (> 230).
  // If the perimeter average is bright, enforce pure white for crisp comic look
  if (bgR > 215 && bgG > 215 && bgB > 215) {
    bgR = 255;
    bgG = 255;
    bgB = 255;
  }

  const bgLuminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // 2. Erase interior text pixels that contrast with the background
  // We keep a safety margin around the bubble perimeter to preserve black borders
  const marginX = Math.max(3, Math.floor(width * 0.08));
  const marginY = Math.max(3, Math.floor(height * 0.08));

  for (let y = marginY; y < height - marginY; y++) {
    for (let x = marginX; x < width - marginX; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Distance from bubble background luminance
      const diff = Math.abs(lum - bgLuminance);

      // If text is dark on light bubble:
      if (bgLuminance > 140 && lum < 185) {
        data[idx] = bgR;
        data[idx + 1] = bgG;
        data[idx + 2] = bgB;
      }
      // If text is light on dark background (inverted bubble):
      else if (bgLuminance <= 140 && lum > 100) {
        data[idx] = bgR;
        data[idx + 1] = bgG;
        data[idx + 2] = bgB;
      }
    }
  }

  ctx.putImageData(imgData, startX, startY);
}

/**
 * Applies a manual brush or eraser stroke onto a canvas
 */
export function applyBrush(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  color = '#ffffff',
  isEraser = false
) {
  ctx.save();
  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
  }

  ctx.lineWidth = radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(toX, toY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
