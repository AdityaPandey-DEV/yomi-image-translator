# Yomi Manga & Comic AI Translator Studio (Clean-Room REA Recreation)

An AI-powered in-image manga, manhwa, comic, and webtoon translation studio and browser extension reverse-engineered from **[YomiTranslator](https://yomi-translator.vercel.app/)** using the **REA (Reverse Engineer Anything)** methodology.

---

## 🌟 What is Included

This repository contains **both** components of the Yomi ecosystem:

1. **The Interactive Web App Studio** (`src/`):
   - **Interactive Canvas**: Pan & Zoom, 8-point bubble manipulation, rotation handles, drag-and-drop repositioning.
   - **Split Comparison Slider**: Real-time slider comparing raw Japanese scans against clean translated comic pages.
   - **Typesetting Engine**: Orthographic safety rules, orphan punctuation prevention, CJK vertical punctuation mapping, binary-search font size auto-fitting, comic font halo outlines.
   - **Bubble Inpainting & Eraser**: Cleanly erases text from speech bubbles while preserving screentones, lineart, and artwork. Includes a manual inpainting brush and eraser tool with a full 30-step undo/redo stack.
   - **Batch Queue & Format Support**: Upload raw images (`PNG`, `JPG`, `WEBP`, `AVIF`), archives (`ZIP`, `CBZ`), PDFs, and native Yomi project files (`.yomi`).
   - **Export Suite**: Export single pages (PNG), whole chapters as ZIP, PDF chapters, `.yomi` project files, and dialogue scripts (`.txt`).
   - **Continuous Reading Mode**: Vertical webtoon-style reader with one-click translation toggling.
   - **Dialogue Script Studio**: Full-chapter text review table with global find-and-replace.
   - **Multi-LLM BYOK Engine**: Built-in support for Google Gemini (2.5/2.0 Flash, 1.5 Pro), OpenAI (GPT-4o, GPT-4o-mini), Anthropic Claude 3.5 Sonnet, DeepSeek V3/R1, xAI Grok, OpenRouter, and Local Ollama / LM Studio.

2. **The Browser Extension** (`extension/`):
   - **Manifest V3** compatible with Google Chrome, Brave, Microsoft Edge, Opera, and Firefox.
   - **⛩️ Yomi Gate on Hover**: Hovers over any image on any manga site (e.g. MangaDex, Webtoons, raw scans, Twitter/X) and displays the Yomi gate icon.
   - **In-Place Translation**: Click the gate to translate directly over the webpage's image without opening a new tab.
   - **Auto-Translate on Scroll**: Automatically translates long chapter strips and manhwa pages as you scroll.
   - **Context Menu Integration**: Right click any image $\to$ *"Translate Manga Image with Yomi"*.

---

## 🚀 Running the Web Studio

```bash
# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧩 Installing the Browser Extension

To load the extension into your browser:

1. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`).
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `extension/` folder located at:
   ```
   /Users/adityapandeydev/Desktop/image translator/extension
   ```
5. Browse any manga website or image, hover over an image, and click the Yomi gate to translate!

---

## 🔬 Reverse Engineering Dossier

For the complete technical deconstruction, API protocol documentation, and mathematical typesetting algorithms, see the REA artifact:
👉 [yomi_translator_rea_reverse_engineering.md](file:///Users/adityapandeydev/.gemini/antigravity-ide/brain/e7d1e739-ff06-49f4-8a42-13d3e6bcd7a1/yomi_translator_rea_reverse_engineering.md)
