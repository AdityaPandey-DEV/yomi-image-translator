// YomiTranslator Core Types (Reverse Engineered Data Model)

export interface TextObject {
  id: string;
  x: number;               // Center X coordinate in image pixel space
  y: number;               // Center Y coordinate in image pixel space
  width: number;           // Bubble width in pixels
  height: number;          // Bubble height in pixels
  angle: number;           // Rotation angle in degrees
  
  // Text Content
  raw_text: string;        // Original foreign text detected by OCR (Japanese / Korean / Chinese)
  text: string;            // Translated and formatted text
  source_lang?: string;    // 'ja' | 'ko' | 'zh' | 'auto'
  
  // Typography & Styling
  font: string;            // 'Comic Neue' | 'Bangers' | 'Anime Ace' | 'Wild Words' | 'Permanent Marker' | 'Noto Sans JP' | 'sans-serif'
  fontSize: number;        // Computed or manual font size in px
  autoFit: boolean;        // Whether font size auto-fits to bubble boundaries
  fontColor: string;       // Hex color (e.g. #000000)
  strokeColor: string;     // Text outline halo (e.g. #ffffff)
  strokeWidth: number;     // Outline width (e.g. 3.5)
  strokeDisabled: boolean; // Outline toggle
  textAlign: 'center' | 'left' | 'right';
  vertical: boolean;       // Vertical Japanese/Chinese typesetting
  uppercase: boolean;      // UPPERCASE comic lettering format
  lineHeight: number;      // Line height multiplier (e.g. 1.15)
  
  // Geometry & Flags
  bubbleOnly?: boolean;
  ocr?: boolean;
}

export type PageStatus = 'idle' | 'detecting' | 'translating' | 'inpainting' | 'done' | 'error';

export interface PageImage {
  id: string;
  filename: string;
  originalSrc: string;          // Data URL or Object URL of original raw image
  inpaintedSrc?: string | null;  // Data URL of image with text bubbles erased
  colorizedSrc?: string | null;  // Optional AI colorized layer
  textObjects: TextObject[];
  history: {
    past: TextObject[][];
    future: TextObject[][];
  };
  width: number;
  height: number;
  status: PageStatus;
  errorMessage?: string;
  contextSummary?: string;      // Multi-page narrative context passed to next page
  createdDate: number;
}

export type AIProvider = 'google' | 'openai' | 'anthropic' | 'deepseek' | 'xai' | 'openrouter' | 'local' | 'mock';

export interface BYOKConfig {
  activeProvider: AIProvider;
  googleApiKey: string;
  googleModel: string;
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
  xaiApiKey: string;
  xaiModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  localUrl: string;             // e.g. http://localhost:11434/v1
  localModel: string;           // e.g. llama3.2-vision or qwen2.5-vl
  
  // Translation Preferences
  targetLanguage: string;       // e.g. 'en', 'es', 'fr', 'de', etc.
  sourceLanguage: string;       // 'auto' | 'ja' | 'ko' | 'zh'
  customPrompt: string;
  preserveHonorifics: boolean;  // Keep -san, -kun, -chan, -senpai
  sfxMode: 'translate' | 'leave' | 'subtext'; // Sound effects handling
  contextAwareness: boolean;    // Pass previous page context
  fontDefault: string;
  strokeEnabled: boolean;
  uppercaseDefault: boolean;
  inpaintMultiplier: number;    // Mask dilation padding (1.0 to 2.5)
}

export type EditorTool = 'select' | 'bubble-add' | 'brush' | 'eraser' | 'pan';

export type ViewMode = 'split' | 'translated' | 'original' | 'inpainted';

export interface YomiProjectFile {
  format: 'yomi-project';
  version: '2.0';
  generator: 'Yomi Translator Clean-Room REA';
  exportedAt: string;
  settings: Partial<BYOKConfig>;
  pages: {
    id: string;
    filename: string;
    originalSrc: string;
    inpaintedSrc?: string | null;
    width: number;
    height: number;
    textObjects: TextObject[];
  }[];
}
