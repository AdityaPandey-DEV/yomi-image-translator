// Yomi Image Translator - Professional Content Script v2.3.0
// Features: Queue-based rate limiting, zero-flicker DOM isolation, anti-infinite-loop guards.

(() => {
  // Constants & State
  const WRAPPER_CLASS = 'yomi-manga-wrapper';
  const PROCESSED_ATTR = 'data-yomi-processed';
  
  let autoTranslate = false;
  let targetLang = 'en';
  let byok = {};
  
  // Rate-limiting queue to stay well under Gemini Free Tier limits (15 requests/min)
  const translationQueue = [];
  let isQueueProcessing = false;
  let isRateLimitedUntil = 0;

  // Load extension settings from storage
  function loadSettings() {
    chrome.storage.sync.get(['autoTranslate', 'targetLang', 'byok'], data => {
      autoTranslate = Boolean(data?.autoTranslate);
      targetLang = data?.targetLang || 'en';
      byok = data?.byok || {};
    });
  }
  loadSettings();
  chrome.storage.onChanged.addListener(() => loadSettings());

  // Debounce helper
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Viewport scroll observer: Enqueues images only when they enter active screen
  const scrollObserver = new IntersectionObserver(
    entries => {
      if (!autoTranslate) return;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const state = img.dataset.yomiState;
          // Only enqueue if never processed and never failed
          if (!state || state === 'idle') {
            enqueueTranslation(img);
          }
        }
      });
    },
    { rootMargin: '100px 0px' }
  );

  // Scan page for manga/comic images without touching yomi elements
  function scanImages() {
    const images = document.querySelectorAll(`img:not([${PROCESSED_ATTR}])`);
    images.forEach(img => {
      // Ignore avatars, icons, badges, and images inside our own wrapper
      if (img.closest(`.${WRAPPER_CLASS}`) || img.closest('[class*="yomi-"]')) return;

      const w = img.naturalWidth || img.clientWidth;
      const h = img.naturalHeight || img.clientHeight;

      if (w > 280 && h > 280) {
        attachYomiGate(img);
      } else if (!img.complete) {
        img.addEventListener(
          'load',
          () => {
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (nw > 280 && nh > 280) attachYomiGate(img);
          },
          { once: true }
        );
      }
    });
  }

  function attachYomiGate(img) {
    if (img.getAttribute(PROCESSED_ATTR)) return;
    if (img.closest(`.${WRAPPER_CLASS}`)) return;

    img.setAttribute(PROCESSED_ATTR, 'true');
    img.dataset.yomiState = 'idle';

    // Temporarily pause mutation observer to avoid self-triggering flickering loop
    mutationObserver.disconnect();

    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    // Floating Translate Action Button
    const gateBtn = document.createElement('button');
    gateBtn.className = 'yomi-gate-button';
    gateBtn.title = 'Translate with Yomi AI';
    gateBtn.innerHTML = `
      <svg class="yomi-gate-svg" viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
      <span class="yomi-btn-label">Translate</span>
    `;

    gateBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      manualTrigger(img, wrapper, gateBtn);
    });

    wrapper.appendChild(gateBtn);

    // Reconnect mutation observer
    startMutationObserver();

    scrollObserver.observe(img);
  }

  // Manual click on button
  function manualTrigger(img, wrapper, gateBtn) {
    const state = img.dataset.yomiState;

    // Toggle between translated & raw if already finished
    if (state === 'done') {
      const overlay = wrapper.querySelector('.yomi-overlay-canvas');
      const toggleBadge = wrapper.querySelector('.yomi-toggle-badge');
      if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
        if (toggleBadge) toggleBadge.innerText = isHidden ? 'Translated (Click for Raw)' : 'Raw Scan (Click to Translate)';
        gateBtn.classList.toggle('yomi-active', isHidden);
      }
      return;
    }

    // Reset failed state if user manually retries
    if (state === 'error') {
      img.dataset.yomiState = 'idle';
    }

    enqueueTranslation(img, true); // priority enqueue
  }

  // Enqueue an image for controlled sequential processing
  function enqueueTranslation(img, highPriority = false) {
    if (img.dataset.yomiState === 'queued' || img.dataset.yomiState === 'loading' || img.dataset.yomiState === 'done') {
      return;
    }

    img.dataset.yomiState = 'queued';
    const wrapper = img.closest(`.${WRAPPER_CLASS}`);
    const gateBtn = wrapper?.querySelector('.yomi-gate-button');
    if (gateBtn) {
      gateBtn.classList.add('yomi-queued');
      const label = gateBtn.querySelector('.yomi-btn-label');
      if (label) label.innerText = 'Queued...';
    }

    if (highPriority) {
      translationQueue.unshift(img);
    } else {
      translationQueue.push(img);
    }

    processQueue();
  }

  // Process queue 1 image at a time with respectful pacing (2s spacing)
  async function processQueue() {
    if (isQueueProcessing) return;
    if (translationQueue.length === 0) return;

    // If temporarily rate limited by Gemini, pause queue
    const now = Date.now();
    if (now < isRateLimitedUntil) {
      const waitSeconds = Math.ceil((isRateLimitedUntil - now) / 1000);
      setTimeout(processQueue, Math.min(waitSeconds * 1000, 5000));
      return;
    }

    isQueueProcessing = true;
    const img = translationQueue.shift();

    if (!img || !document.contains(img)) {
      isQueueProcessing = false;
      processQueue();
      return;
    }

    await executeImageTranslation(img);

    isQueueProcessing = false;

    // Respectful delay between successive calls to avoid 429 quota exhaustion
    setTimeout(processQueue, 2000);
  }

  async function executeImageTranslation(img) {
    const wrapper = img.closest(`.${WRAPPER_CLASS}`);
    const gateBtn = wrapper?.querySelector('.yomi-gate-button');
    const label = gateBtn?.querySelector('.yomi-btn-label');

    img.dataset.yomiState = 'loading';

    if (gateBtn) {
      gateBtn.classList.remove('yomi-queued');
      gateBtn.classList.add('yomi-loading');
      if (label) label.innerText = 'Translating...';
    }

    try {
      const src = img.currentSrc || img.src;

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: 'TRANSLATE_PAYLOAD',
            data: { imageUrl: src, targetLang, byok },
          },
          res => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(res);
            }
          }
        );
      });

      if (response?.success && response.result?.bubbles) {
        img.dataset.yomiState = 'done';
        renderOverlay(img, wrapper, response.result.bubbles);

        if (gateBtn) {
          gateBtn.classList.remove('yomi-loading');
          gateBtn.classList.add('yomi-active');
          if (label) label.innerText = 'Translated';
        }

        attachToggleBadge(wrapper, img);
      } else {
        const errorMsg = response?.error || 'Translation failed';
        img.dataset.yomiState = 'error';

        // Check if rate limited
        if (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('rate-limit') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          isRateLimitedUntil = Date.now() + 35000; // Pause for 35 seconds
          showToast(wrapper, '⏳ Gemini Rate Limit: Free Tier limit reached. Pausing for 35s...', 8000);
        } else {
          showToast(wrapper, `Yomi: ${errorMsg}`, 5000);
        }

        if (gateBtn) {
          gateBtn.classList.remove('yomi-loading', 'yomi-queued');
          if (label) label.innerText = 'Retry';
        }
      }
    } catch (err) {
      console.warn('[Yomi]', err);
      img.dataset.yomiState = 'error';
      showToast(wrapper, 'Yomi: Translation failed. Click Retry.', 4000);

      if (gateBtn) {
        gateBtn.classList.remove('yomi-loading', 'yomi-queued');
        if (label) label.innerText = 'Retry';
      }
    }
  }

  function renderOverlay(img, wrapper, bubbles) {
    if (!wrapper || !bubbles || bubbles.length === 0) return;

    let canvas = wrapper.querySelector('.yomi-overlay-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'yomi-overlay-canvas';
      wrapper.appendChild(canvas);
    }

    const nw = img.naturalWidth || img.clientWidth || img.width;
    const nh = img.naturalHeight || img.clientHeight || img.height;

    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    bubbles.forEach(b => {
      const text = (b.translated_text || '').trim();
      if (!text) return;

      const bw = Math.max(20, b.width);
      const bh = Math.max(20, b.height);
      const bx = b.x;
      const by = b.y;

      ctx.save();

      // Clean speech bubble background
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(bx, by, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Typeset dialogue with centered multiline word-wrapping
      let fontSize = Math.max(12, Math.min(24, Math.round(bw / 7.5)));
      ctx.font = `bold ${fontSize}px "WildWords", "Comic Neue", -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxLineWidth = Math.max(20, bw * 0.82);
      const words = text.split(/\s+/);
      let lines = [];
      let currentLine = '';

      for (let word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxLineWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      let lineHeight = fontSize * 1.25;
      if (lines.length * lineHeight > bh * 0.85) {
        fontSize = Math.max(10, Math.round(fontSize * 0.8));
        ctx.font = `bold ${fontSize}px "WildWords", "Comic Neue", -apple-system, sans-serif`;
        lineHeight = fontSize * 1.2;
      }

      const totalHeight = lines.length * lineHeight;
      const startY = by - (totalHeight / 2) + (lineHeight / 2);

      lines.forEach((line, idx) => {
        const curY = startY + (idx * lineHeight);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, bx, curY, maxLineWidth);

        ctx.fillStyle = '#0f172a';
        ctx.fillText(line, bx, curY, maxLineWidth);
      });

      ctx.restore();
    });
  }

  function attachToggleBadge(wrapper, img) {
    if (wrapper.querySelector('.yomi-toggle-badge')) return;

    const badge = document.createElement('button');
    badge.className = 'yomi-toggle-badge';
    badge.innerText = 'Translated (Click for Raw)';
    badge.title = 'Click to toggle between original raw and translated';

    badge.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = wrapper.querySelector('.yomi-overlay-canvas');
      if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
        badge.innerText = isHidden ? 'Translated (Click for Raw)' : 'Raw Scan (Click to Translate)';
      }
    });

    wrapper.appendChild(badge);
  }

  function showToast(wrapper, message, duration = 4000) {
    const existing = wrapper?.querySelector('.yomi-toast-banner');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'yomi-toast-banner';
    toast.innerText = message;
    wrapper?.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // MutationObserver with strict filtering and debounce to avoid infinite loop
  let mutationObserver;
  const debouncedScan = debounce(scanImages, 300);

  function startMutationObserver() {
    if (!mutationObserver) {
      mutationObserver = new MutationObserver(mutations => {
        let hasRelevantMutation = false;
        for (const m of mutations) {
          // Ignore any DOM change created by our own yomi elements
          if (m.target?.nodeType === 1) {
            const el = m.target;
            if (el.classList?.contains(WRAPPER_CLASS) || el.className?.toString().includes('yomi-')) {
              continue;
            }
          }
          hasRelevantMutation = true;
          break;
        }
        if (hasRelevantMutation) {
          debouncedScan();
        }
      });
    }

    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  startMutationObserver();
  scanImages();

  // Context Menu trigger
  chrome.runtime.onMessage.addListener(request => {
    if (request.action === 'TRANSLATE_IMAGE_SRC') {
      const match = Array.from(document.querySelectorAll('img')).find(
        i => (i.currentSrc || i.src) === request.srcUrl
      );
      if (match) {
        const wrapper = match.closest(`.${WRAPPER_CLASS}`);
        const gateBtn = wrapper?.querySelector('.yomi-gate-button');
        manualTrigger(match, wrapper, gateBtn);
      }
    }
  });
})();
