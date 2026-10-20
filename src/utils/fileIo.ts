// Reverse-Engineered File Ingestion, Extraction & Export Engine (Yomi Translator)
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { PageImage, YomiProjectFile, BYOKConfig, TextObject } from '../types';
import { renderTextObject } from './typesetting';

/**
 * Parses user dropped or uploaded files (Images, ZIP, CBZ, .yomi)
 */
export async function parseUploadedFiles(
  files: FileList | File[],
  defaultConfig: BYOKConfig
): Promise<{ pages: PageImage[]; projectConfig?: Partial<BYOKConfig> }> {
  const pages: PageImage[] = [];
  let projectConfig: Partial<BYOKConfig> | undefined;

  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'yomi') {
      // Import Yomi Project File
      try {
        const text = await file.text();
        const project: YomiProjectFile = JSON.parse(text);
        if (project.settings) projectConfig = project.settings;

        for (const p of project.pages) {
          pages.push({
            id: p.id || `page-${Date.now()}-${Math.random()}`,
            filename: p.filename,
            originalSrc: p.originalSrc,
            inpaintedSrc: p.inpaintedSrc || null,
            textObjects: p.textObjects || [],
            history: { past: [], future: [] },
            width: p.width,
            height: p.height,
            status: 'done',
            createdDate: Date.now(),
          });
        }
      } catch (err) {
        console.error('Failed to parse .yomi project file', err);
      }
    } else if (ext === 'zip' || ext === 'cbz') {
      // Extract ZIP / CBZ archive
      try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);
        const imageEntries: { name: string; file: JSZip.JSZipObject }[] = [];

        zipContent.forEach((path, entry) => {
          if (!entry.dir && /\.(png|jpe?g|webp|avif)$/i.test(path) && !path.includes('__MACOSX')) {
            imageEntries.push({ name: path, file: entry });
          }
        });

        // Natural sort by filename (e.g. page_1, page_2, page_10)
        imageEntries.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        for (const item of imageEntries) {
          const blob = await item.file.async('blob');
          const dataUrl = await blobToDataUrl(blob);
          const dims = await getImageDimensions(dataUrl);

          pages.push({
            id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            filename: item.name.split('/').pop() || item.name,
            originalSrc: dataUrl,
            inpaintedSrc: null,
            textObjects: [],
            history: { past: [], future: [] },
            width: dims.width,
            height: dims.height,
            status: 'idle',
            createdDate: Date.now(),
          });
        }
      } catch (err) {
        console.error('Failed to parse ZIP/CBZ', err);
      }
    } else if (/\.(png|jpe?g|webp|avif)$/i.test(file.name)) {
      // Single Image
      const dataUrl = await blobToDataUrl(file);
      const dims = await getImageDimensions(dataUrl);

      pages.push({
        id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        filename: file.name,
        originalSrc: dataUrl,
        inpaintedSrc: null,
        textObjects: [],
        history: { past: [], future: [] },
        width: dims.width,
        height: dims.height,
        status: 'idle',
        createdDate: Date.now(),
      });
    }
  }

  return { pages, projectConfig };
}

/**
 * Converts a Blob or File to a DataURL string
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Retrieves natural width & height of an image data URL
 */
export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 1200 });
    img.onerror = () => resolve({ width: 800, height: 1200 });
    img.src = dataUrl;
  });
}

/**
 * Flattens a page's inpainted layer + text objects onto a final PNG canvas
 */
export async function renderFinalPageCanvas(page: PageImage): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext('2d')!;

  const baseImg = new Image();
  baseImg.crossOrigin = 'anonymous';
  await new Promise(resolve => {
    baseImg.onload = resolve;
    baseImg.src = page.inpaintedSrc || page.originalSrc;
  });

  // Draw background image
  ctx.drawImage(baseImg, 0, 0, page.width, page.height);

  // Render text bubbles
  for (const obj of page.textObjects) {
    renderTextObject(ctx, obj, 1.0, false);
  }

  return canvas;
}

/**
 * Downloads a single page as high-res PNG or JPEG
 */
export async function exportSinglePage(page: PageImage, format: 'png' | 'jpeg' = 'png') {
  const canvas = await renderFinalPageCanvas(page);
  const dataUrl = canvas.toDataURL(`image/${format}`, 0.95);
  const link = document.createElement('a');
  link.download = `${page.filename.replace(/\.[^/.]+$/, '')}_translated.${format}`;
  link.href = dataUrl;
  link.click();
}

/**
 * Bundles all translated pages into a ZIP archive and triggers download
 */
export async function exportAllPagesAsZip(
  pages: PageImage[],
  zipName = 'manga_chapter_translated.zip'
) {
  const zip = new JSZip();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = await renderFinalPageCanvas(page);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64Data = dataUrl.split(',')[1];
    const paddedNum = String(i + 1).padStart(3, '0');
    zip.file(`page_${paddedNum}_${page.filename.replace(/\.[^/.]+$/, '')}.jpg`, base64Data, {
      base64: true,
    });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = zipName;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Exports all pages as a PDF chapter
 */
export async function exportAllPagesAsPdf(pages: PageImage[], pdfName = 'manga_chapter.pdf') {
  if (pages.length === 0) return;

  const firstPage = pages[0];
  const orientation = firstPage.width > firstPage.height ? 'l' : 'p';
  const pdf = new jsPDF(orientation, 'pt', [firstPage.width, firstPage.height]);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = await renderFinalPageCanvas(page);
    const imgData = canvas.toDataURL('image/jpeg', 0.9);

    if (i > 0) {
      pdf.addPage([page.width, page.height], page.width > page.height ? 'l' : 'p');
    }
    pdf.addImage(imgData, 'JPEG', 0, 0, page.width, page.height);
  }

  pdf.save(pdfName);
}

/**
 * Exports Yomi project file (`.yomi`) containing full editable layers
 */
export function exportYomiProject(pages: PageImage[], config: BYOKConfig) {
  const project: YomiProjectFile = {
    format: 'yomi-project',
    version: '2.0',
    generator: 'Yomi Translator Clean-Room REA',
    exportedAt: new Date().toISOString(),
    settings: {
      targetLanguage: config.targetLanguage,
      sourceLanguage: config.sourceLanguage,
      fontDefault: config.fontDefault,
      strokeEnabled: config.strokeEnabled,
      uppercaseDefault: config.uppercaseDefault,
    },
    pages: pages.map(p => ({
      id: p.id,
      filename: p.filename,
      originalSrc: p.originalSrc,
      inpaintedSrc: p.inpaintedSrc,
      width: p.width,
      height: p.height,
      textObjects: p.textObjects,
    })),
  };

  const jsonString = JSON.stringify(project, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `yomi_chapter_${Date.now()}.yomi`;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Exports dialogue scripts for proofreading (Yomi's Export Texts feature)
 */
export function exportDialogueScript(pages: PageImage[]) {
  let content = `=== TORII TRANSLATOR DIALOGUE SCRIPT ===\nGenerated: ${new Date().toLocaleString()}\n\n`;

  pages.forEach((page, pIdx) => {
    content += `----------------------------------------\n`;
    content += `PAGE ${pIdx + 1}: ${page.filename}\n`;
    content += `----------------------------------------\n`;

    if (page.textObjects.length === 0) {
      content += `(No dialogue detected)\n\n`;
      return;
    }

    page.textObjects.forEach((bubble, bIdx) => {
      content += `[Bubble #${bIdx + 1}]\n`;
      if (bubble.raw_text) content += `RAW:        ${bubble.raw_text}\n`;
      content += `TRANSLATED: ${bubble.text}\n\n`;
    });
  });

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `manga_script_${Date.now()}.txt`;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
