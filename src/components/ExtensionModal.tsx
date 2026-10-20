import React, { useState } from 'react';
import { X, Puzzle, Download, CheckCircle, ExternalLink, Globe, Layers } from 'lucide-react';
import JSZip from 'jszip';

interface ExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExtensionModal: React.FC<ExtensionModalProps> = ({ isOpen, onClose }) => {
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  const handleDownloadZip = () => {
    const link = document.createElement('a');
    link.href = '/yomi-extension.zip';
    link.download = 'yomi-extension.zip';
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/15 text-orange-400">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-100">Yomi Browser Extension</h2>
              <p className="text-xs text-neutral-400">
                Translate manga directly on any reader website as you scroll.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Extension Features Showcase */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
              <span className="text-xs font-bold text-orange-400 block mb-1">
                ⛩️ Yomi Gate on Hover
              </span>
              <p className="text-[11px] text-neutral-400">
                Hover any manga or webtoon image on any site. Click the gate in the corner to translate.
              </p>
            </div>
            <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800">
              <span className="text-xs font-bold text-emerald-400 block mb-1">
                ⚡ Auto-Translate on Scroll
              </span>
              <p className="text-[11px] text-neutral-400">
                Turn on auto-translate in the popup to translate long chapter pages seamlessly as you scroll.
              </p>
            </div>
          </div>

          {/* One-Click Download ZIP Banner */}
          <div className="p-4 bg-gradient-to-r from-orange-950/40 to-neutral-900 border border-orange-500/30 rounded-xl flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-neutral-100 flex items-center gap-1.5">
                <Download className="w-4 h-4 text-orange-400" />
                Yomi Chrome Extension Package (.zip)
              </span>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Pre-packaged Manifest V3 ZIP ready to unzip and load directly into Chrome.
              </p>
            </div>
            <button
              onClick={handleDownloadZip}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/25 shrink-0 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download .ZIP
            </button>
          </div>

          {/* Installation Steps */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
              How to Install in Chrome / Edge / Brave / Opera
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-xs">
                  1
                </span>
                <div>
                  <strong className="text-neutral-200 block">Open Extensions Page</strong>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Navigate to <code className="text-orange-400 bg-neutral-900 px-1.5 py-0.5 rounded">chrome://extensions</code> in your browser.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-xs">
                  2
                </span>
                <div>
                  <strong className="text-neutral-200 block">Enable Developer Mode</strong>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Toggle the <strong>Developer mode</strong> switch in the top-right corner of the extensions page.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-xs">
                  3
                </span>
                <div>
                  <strong className="text-neutral-200 block">Load Unpacked Extension</strong>
                  <p className="text-neutral-400 text-[11px] mt-0.5">
                    Click <strong>Load unpacked</strong> and select the directory:
                    <br />
                    <code className="text-orange-400 bg-neutral-900 px-1.5 py-0.5 rounded break-all mt-1 inline-block">
                      /Users/adityapandeydev/Desktop/image translator/extension
                    </code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <span className="text-[11px] text-neutral-400">
            Path: <code className="text-neutral-300">./extension/</code>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white"
          >
            Ready to Read!
          </button>
        </div>
      </div>
    </div>
  );
};
