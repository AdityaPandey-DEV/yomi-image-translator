// Reverse-Engineered Typesetting & Comic Orthographic Engine (Yomi Translator)
import { TextObject } from '../types';

export const VERTICAL_PUNCT_MAP: Record<string, string> = {
  '\u2014': '\ufe31',  // — em dash           → ︱
  '\u2015': '\ufe31',  // ― horizontal bar     → ︱
  '\u2013': '\ufe32',  // – en dash            → ︲
  '\u2012': '\ufe32',  // ‒ figure dash        → ︲
  '\u30fc': '\ufe31',  // ー katakana long vowel→ ︱
  '\uff0d': '\ufe31',  // － fullwidth hyphen   → ︱
  '\uff5e': '\ufe31',  // ～ fullwidth tilde    → ︱
  '\u2500': '\ufe31',  // ─ box drawing horiz  → ︱
  '\u002d': '\ufe32',  // - hyphen-minus        → ︲
  '\u2026': '\ufe19',  // … ellipsis           → ︙
  '\u2025': '\ufe19',  // ‥ two-dot leader     → ︙
  '\uff08': '\ufe35',  // （left paren         → ︵
  '\uff09': '\ufe36',  // ）right paren        → ︶
  '\u300c': '\ufe41',  // 「left corner        → ﹁
  '\u300d': '\ufe42',  // 」right corner       → ﹂
  '\u300e': '\ufe43',  // 『left white         → ﹃
  '\u300f': '\ufe44',  // 』right white        → ﹄
  '\u3010': '\ufe3b',  // 【left black         → ︻
  '\u3011': '\ufe3c',  // 】right black        → ︼
  '\u300a': '\ufe3d',  // 《left dbl angle     → ︽
  '\u300b': '\ufe3e',  // 》right dbl angle    → ︾
  '\u3008': '\ufe3f',  // 〈left angle         → ︿
  '\u3009': '\ufe40',  // 〉right angle        → ﹀
  '\uff0c': '\ufe10',  // ，fullwidth comma     → ︐
  '\u3001': '\ufe11',  // 、ideographic comma   → ︑
  '\u3002': '\ufe12',  // 。ideographic fullstop→ ︒
  '\uff1a': '\ufe13',  // ：fullwidth colon     → ︓
  '\uff1b': '\ufe14',  // ；fullwidth semicolon → ︔
  '\uff01': '\ufe15',  // ！fullwidth exclamation→ ︕
  '\uff1f': '\ufe16',  // ？fullwidth question  → ︖
};

// CJK and non-space scripts
const NO_SPACE_SCRIPT_RE = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF9F]/;

// Opening marks that must never be stranded at the end of a line (e.g. Spanish ¿ and ¡)
const OPENING_MARK_RE = /[¡¿([{«‹‘‚‛“„‟〈《「『【〔〖〘〚〝（［｛｟｢#@$£¥§₦₩€₱₹₽฿№]/;

// Closing and terminal marks that must never start a line
const NO_LINE_START_RE = /^[\.,!\?:;…\-—―–‒ー－～─‥）」』】》〉，、。：；！？，。、،۔\)\]}）】ๆฯໆຯ〕〗”’♪~．〙〛]/;

export function convertToVerticalPunctuation(text: string): string {
  let result = '';
  for (const char of text) {
    result += VERTICAL_PUNCT_MAP[char] || char;
  }
  return result;
}

/**
 * Splits text into lines fitting within maxWidth while respecting comic line-breaking rules.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: number
): string[] {
  ctx.font = `bold ${fontSize}px "${fontFamily}", -apple-system, sans-serif`;

  // Preserve explicit newlines
  const paragraphs = text.split('\n');
  const allLines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      allLines.push('');
      continue;
    }

    const words = para.split(/(\s+)/);
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;

      const testLine = currentLine + word;
      const metrics = ctx.measureText(testLine.trim());

      if (metrics.width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine.trim()) {
          // Check punctuation orphan rule: don't leave opening mark at end of line
          const trimmed = currentLine.trim();
          if (OPENING_MARK_RE.test(trimmed.slice(-1))) {
            const lastChar = trimmed.slice(-1);
            currentLine = trimmed.slice(0, -1);
            allLines.push(currentLine.trim());
            currentLine = lastChar + word;
          } else {
            // Check no line start rule for next line
            if (NO_LINE_START_RE.test(word.trim())) {
              // Word starts with forbidden character, pull one token or hyphenate
              allLines.push(currentLine.trim());
              currentLine = word;
            } else {
              allLines.push(currentLine.trim());
              currentLine = word;
            }
          }
        } else {
          // Single word wider than line, forced split
          let subWord = '';
          for (const char of word) {
            if (ctx.measureText(subWord + char).width <= maxWidth) {
              subWord += char;
            } else {
              if (subWord) allLines.push(subWord);
              subWord = char;
            }
          }
          currentLine = subWord;
        }
      }
    }

    if (currentLine.trim()) {
      allLines.push(currentLine.trim());
    }
  }

  return allLines;
}

/**
 * Binary search for maximum font size that fits text inside bubble width & height
 */
export function computeOptimalFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  boxWidth: number,
  boxHeight: number,
  fontFamily: string,
  minSize = 10,
  maxSize = 64
): number {
  const paddingX = Math.max(8, boxWidth * 0.12);
  const paddingY = Math.max(8, boxHeight * 0.12);
  const usableWidth = Math.max(20, boxWidth - paddingX);
  const usableHeight = Math.max(20, boxHeight - paddingY);

  let low = minSize;
  let high = maxSize;
  let best = minSize;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lines = wrapText(ctx, text, usableWidth, fontFamily, mid);
    const lineHeight = mid * 1.18;
    const totalHeight = lines.length * lineHeight;

    const widestLine = Math.max(
      ...lines.map(line => {
        ctx.font = `bold ${mid}px "${fontFamily}", -apple-system, sans-serif`;
        return ctx.measureText(line).width;
      }),
      0
    );

    if (totalHeight <= usableHeight && widestLine <= usableWidth) {
      best = mid;
      low = mid + 1; // Try larger font
    } else {
      high = mid - 1; // Too big, reduce
    }
  }

  return best;
}

/**
 * Draws a single speech bubble text object onto a canvas context with comic-grade stroke and fill
 */
export function renderTextObject(
  ctx: CanvasRenderingContext2D,
  textObj: TextObject,
  scale = 1.0,
  isSelected = false
) {
  const displayText = textObj.uppercase ? textObj.text.toUpperCase() : textObj.text;
  if (!displayText) return;

  const fontFam = textObj.font || 'Comic Neue';
  const effectiveFontSize = textObj.autoFit
    ? computeOptimalFontSize(ctx, displayText, textObj.width, textObj.height, fontFam)
    : textObj.fontSize || 16;

  ctx.save();

  // Position at bubble center and rotate if needed
  ctx.translate(textObj.x * scale, textObj.y * scale);
  if (textObj.angle) {
    ctx.rotate((textObj.angle * Math.PI) / 180);
  }

  const scaledWidth = textObj.width * scale;
  const scaledHeight = textObj.height * scale;
  const scaledFontSize = effectiveFontSize * scale;

  if (textObj.vertical) {
    // Vertical CJK Text Typesetting
    const vText = convertToVerticalPunctuation(displayText);
    const chars = Array.from(vText);
    const charSpacing = scaledFontSize * 1.05;
    const totalVHeight = chars.length * charSpacing;
    const startY = -totalVHeight / 2 + scaledFontSize / 2;

    ctx.font = `bold ${scaledFontSize}px "${fontFam}", "Noto Sans JP", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    chars.forEach((char, index) => {
      const cy = startY + index * charSpacing;
      if (!textObj.strokeDisabled && textObj.strokeWidth > 0) {
        ctx.strokeStyle = textObj.strokeColor || '#ffffff';
        ctx.lineWidth = textObj.strokeWidth * scale * 1.8;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(char, 0, cy);
      }
      ctx.fillStyle = textObj.fontColor || '#000000';
      ctx.fillText(char, 0, cy);
    });
  } else {
    // Horizontal Comic Typesetting with Safe Line Wrapping
    const usableWidth = Math.max(10, scaledWidth * 0.88);
    const lines = wrapText(ctx, displayText, usableWidth, fontFam, scaledFontSize);
    const lineHeight = scaledFontSize * (textObj.lineHeight || 1.15);
    const totalTextHeight = lines.length * lineHeight;
    const startY = -totalTextHeight / 2 + lineHeight / 2;

    ctx.font = `bold ${scaledFontSize}px "${fontFam}", -apple-system, sans-serif`;
    ctx.textAlign = textObj.textAlign || 'center';
    ctx.textBaseline = 'middle';

    const getXOffset = () => {
      if (textObj.textAlign === 'left') return -scaledWidth / 2 + 6 * scale;
      if (textObj.textAlign === 'right') return scaledWidth / 2 - 6 * scale;
      return 0;
    };
    const xOffset = getXOffset();

    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;

      // Pass 1: Outline halo stroke (prevents text clash with screentones/art)
      if (!textObj.strokeDisabled && textObj.strokeWidth > 0) {
        ctx.strokeStyle = textObj.strokeColor || '#ffffff';
        ctx.lineWidth = textObj.strokeWidth * scale * 1.8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(line, xOffset, lineY);
      }

      // Pass 2: Sharp crisp foreground fill
      ctx.fillStyle = textObj.fontColor || '#000000';
      ctx.fillText(line, xOffset, lineY);
    });
  }

  // Draw selection highlight bounding box when active
  if (isSelected) {
    ctx.strokeStyle = '#f97316'; // Yomi orange
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([6 * scale, 3 * scale]);
    ctx.strokeRect(-scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
    ctx.setLineDash([]);

    // 8-Point Resize Handles & Rotation Pin
    const handleRadius = 4.5 * scale;
    ctx.fillStyle = '#f97316';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * scale;

    const corners = [
      { x: -scaledWidth / 2, y: -scaledHeight / 2 },
      { x: scaledWidth / 2, y: -scaledHeight / 2 },
      { x: scaledWidth / 2, y: scaledHeight / 2 },
      { x: -scaledWidth / 2, y: scaledHeight / 2 },
      { x: 0, y: -scaledHeight / 2 },
      { x: 0, y: scaledHeight / 2 },
      { x: -scaledWidth / 2, y: 0 },
      { x: scaledWidth / 2, y: 0 },
    ];

    corners.forEach(corner => {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Rotation Handle at Top
    const rotY = -scaledHeight / 2 - 20 * scale;
    ctx.beginPath();
    ctx.moveTo(0, -scaledHeight / 2);
    ctx.lineTo(0, rotY);
    ctx.strokeStyle = '#f97316';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, rotY, handleRadius + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
