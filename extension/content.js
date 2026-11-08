// Manga & Manhwa Image Translator - Content Script v2.0.0
// Features: Queue-based rate limiting, zero-flicker DOM isolation, anti-infinite-loop guards.
// Auth: 3-layer sync architecture with sign-out propagation.

(() => {
  const PORTAL_ORIGIN = 'https://manga-manhwa-translator.vercel.app';

  // ============================================================
  // Companion Website Bridge (BACKUP auth path — Layer 2)
  // PRIMARY auth goes via externally_connectable directly to
  // background.js, bypassing this content script entirely.
  // This bridge is the secondary path + sign-out propagation.
  // ============================================================
  if (window.location.origin === PORTAL_ORIGIN) {

    // --- DOM Bridge: read token from hidden React element ---
    function trySyncFromDom() {
      const bridge = document.getElementById('mmt-auth-bridge');
      if (bridge && bridge.dataset.token) {
        try {
          chrome.runtime.sendMessage({
            action: 'AUTH_TOKEN',
            token: bridge.dataset.token,
            email: bridge.dataset.email || '',
            displayName: bridge.dataset.name || '',
            photoURL: bridge.dataset.photo || '',
            mode: bridge.dataset.mode || 'private',
          });
        } catch (e) {
          // Extension context invalidated — silently ignore
          console.warn('[MMT Content] Extension context invalidated:', e.message);
        }
        return true;
      }
      return false;
    }

    // Immediate DOM check
    trySyncFromDom();

    // DOM Mutation observer — catches token as React hydrates
    let domSyncThrottle = 0;
    const domObserver = new MutationObserver(() => {
      const now = Date.now();
      if (now - domSyncThrottle < 500) return; // Throttle to 2 checks/sec
      domSyncThrottle = now;
      trySyncFromDom();
    });

    if (document.body) {
      domObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        trySyncFromDom();
        if (document.body) {
          domObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
        }
      });
    }

    // --- Window Message Listener (from React web app) ---
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== PORTAL_ORIGIN) return;

      // Auth sync relay
      if (event.data && event.data.type === 'MMT_AUTH_SYNC') {
        const payload = event.data.payload || event.data;
        if (payload.token) {
          try {
            chrome.runtime.sendMessage(
              {
                action: 'AUTH_TOKEN',
                token: payload.token,
                email: payload.email || '',
                displayName: payload.displayName || '',
                photoURL: payload.photoURL || '',
                mode: payload.mode || 'private',
              },
              res => {
                if (chrome.runtime.lastError) {
                  console.warn('[MMT Content] sendMessage error:', chrome.runtime.lastError.message);
                  return;
                }
                if (res?.success) {
                  window.postMessage({ type: 'MMT_AUTH_SYNCED', success: true }, PORTAL_ORIGIN);
                }
              }
            );
          } catch (e) {
            console.warn('[MMT Content] Extension context invalidated:', e.message);
          }
        }
      }

      // Sign-out relay
      if (event.data && event.data.type === 'MMT_AUTH_SIGNOUT') {
        try {
          chrome.runtime.sendMessage({ action: 'AUTH_SIGNOUT' }, res => {
            if (chrome.runtime.lastError) return;
            if (res?.success) {
              window.postMessage({ type: 'MMT_SIGNOUT_CONFIRMED', success: true }, PORTAL_ORIGIN);
            }
          });
        } catch (e) {
          // Extension invalidated
        }
      }

      // Extension detection ping
      if (event.data && event.data.type === 'MMT_CHECK_EXTENSION') {
        window.postMessage({ type: 'MMT_EXTENSION_PONG', version: '2.0.0' }, PORTAL_ORIGIN);
      }
    });

    // --- Messages from background/popup requesting auth or signout ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'FORCE_WEBSITE_SIGNOUT') {
        window.dispatchEvent(new CustomEvent('mmt-extension-signout'));
        try {
          localStorage.removeItem('mmt_auth_session');
        } catch (_) {}
        sendResponse({ success: true });
        return true;
      }

      if (request.action === 'REQUEST_AUTH_FROM_PAGE') {
        const synced = trySyncFromDom();
        if (!synced) {
          window.postMessage({ type: 'MMT_REQUEST_AUTH' }, PORTAL_ORIGIN);
        }
        sendResponse({ success: true, syncedFromDom: synced });
        return true;
      }
    });

    // Signal to webpage that content script is alive
    window.postMessage({ type: 'MMT_EXTENSION_READY', version: '2.0.0' }, PORTAL_ORIGIN);

    // On our companion website, skip manga image scanner
    return;
  }

  // Constants & State
  const WRAPPER_CLASS = 'yomi-manga-wrapper';
  const PROCESSED_ATTR = 'data-yomi-processed';
  
  let autoTranslate = false;
  let targetLang = 'en';
  let siteEnabled = false; // Whitelist: ALL sites OFF by default
  const currentHostname = window.location.hostname;
  
  // Rate-limiting queue
  const translationQueue = [];
  let isQueueProcessing = false;
  let isRateLimitedUntil = 0;

  // Load extension settings from storage
  function loadSettings() {
    chrome.storage.sync.get(['autoTranslate', 'targetLang'], data => {
      autoTranslate = Boolean(data?.autoTranslate);
      targetLang = data?.targetLang || 'en';
    });
    // Check if current site is in the whitelist
    chrome.storage.local.get(['enabledSites'], data => {
      const sites = Array.isArray(data?.enabledSites) ? data.enabledSites : [];
      const wasEnabled = siteEnabled;
      siteEnabled = sites.includes(currentHostname);
      // If just enabled, trigger a scan
      if (siteEnabled && !wasEnabled) {
        scanImages();
      }
    });
  }
  loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    loadSettings();
  });

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
    // Whitelist check: only scan if user has explicitly enabled this site
    if (!siteEnabled) return;

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
    gateBtn.title = 'Translate with AI';
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
            data: { imageUrl: src, targetLang },
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
        const bubbles = response.result.bubbles;
        console.log('[Translator] Received translation response:', bubbles);

        if (!Array.isArray(bubbles) || bubbles.length === 0) {
          img.dataset.yomiState = 'idle';
          if (gateBtn) {
            gateBtn.classList.remove('yomi-loading', 'yomi-active');
            if (label) label.innerText = 'Translate';
          }
          showToast(wrapper, '🔍 No speech bubbles detected in this image section.', 3500);
          return;
        }

        img.dataset.yomiState = 'done';
        renderOverlay(img, wrapper, bubbles);

        if (gateBtn) {
          gateBtn.classList.remove('yomi-loading');
          gateBtn.classList.add('yomi-active');
          if (label) label.innerText = `Translated (${bubbles.length})`;
        }

        attachToggleBadge(wrapper, img);
      } else {
        const errorMsg = response?.error || 'Translation failed';
        img.dataset.yomiState = 'error';

        // Check if rate limited
        if (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('rate-limit') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          isRateLimitedUntil = Date.now() + 35000; // Pause for 35 seconds
          showToast(wrapper, '⏳ Rate Limit: Free Tier limit reached (15 req/min). Pausing 35s... (Tip: You can switch to OpenRouter or OpenAI in the extension popup for higher limits)', 8000);
        } else {
          showToast(wrapper, `Translator: ${errorMsg}`, 5000);
        }

        if (gateBtn) {
          gateBtn.classList.remove('yomi-loading', 'yomi-queued');
          if (label) label.innerText = 'Retry';
        }
      }
    } catch (err) {
      console.warn('[Translator]', err);
      img.dataset.yomiState = 'error';
      showToast(wrapper, 'Translation failed. Click Retry.', 4000);

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

    // Interactive hotspot layer for tooltips showing original text on hover
    let hotspotLayer = wrapper.querySelector('.yomi-hotspot-layer');
    if (!hotspotLayer) {
      hotspotLayer = document.createElement('div');
      hotspotLayer.className = 'yomi-hotspot-layer';
      wrapper.appendChild(hotspotLayer);
    }
    hotspotLayer.innerHTML = '';

    const rect = img.getBoundingClientRect();
    const nw = img.naturalWidth || Math.round(rect.width) || img.clientWidth || img.width || 800;
    const nh = img.naturalHeight || Math.round(rect.height) || img.clientHeight || img.height || 1200;

    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    console.log(`[Translator] Rendering ${bubbles.length} bubbles on canvas: ${nw}x${nh}`);

    bubbles.forEach((b, index) => {
      const text = (b.translated_text || '').trim();
      if (!text) return;

      let top = 0, left = 0, bottom = 0, right = 0;
      let bx = 0, by = 0, bw = 0, bh = 0;

      // 1. Universal Coordinate Resolution (supporting 0..1000, 0.0..1.0, and pixel coordinates)
      const rawBox = b.box_2d || b.bounding_box || b.box;
      if (Array.isArray(rawBox) && rawBox.length === 4) {
        const [y1, x1, y2, x2] = rawBox.map(Number);
        const maxVal = Math.max(y1, x1, y2, x2);

        if (maxVal <= 1.0) {
          // Normalized 0.0 - 1.0
          top = y1 * nh;
          left = x1 * nw;
          bottom = y2 * nh;
          right = x2 * nw;
        } else if (maxVal <= 1000) {
          // Normalized 0 - 1000
          top = (y1 / 1000) * nh;
          left = (x1 / 1000) * nw;
          bottom = (y2 / 1000) * nh;
          right = (x2 / 1000) * nw;
        } else {
          // Absolute pixels
          top = y1;
          left = x1;
          bottom = y2;
          right = x2;
        }

        bw = Math.max(28, right - left);
        bh = Math.max(20, bottom - top);
        bx = left + (bw / 2);
        by = top + (bh / 2);
      } else if (b.x !== undefined && b.y !== undefined) {
        const bxVal = Number(b.x);
        const byVal = Number(b.y);
        const bwVal = Number(b.width || 80);
        const bhVal = Number(b.height || 40);

        if (bxVal <= 1.0 && byVal <= 1.0) {
          left = bxVal * nw;
          top = byVal * nh;
          bw = Math.max(28, bwVal * nw);
          bh = Math.max(20, bhVal * nh);
        } else if (bxVal <= 1000 && nw > 1000) {
          left = (bxVal / 1000) * nw;
          top = (byVal / 1000) * nh;
          bw = Math.max(28, (bwVal / 1000) * nw);
          bh = Math.max(20, (bhVal / 1000) * nh);
        } else {
          left = bxVal;
          top = byVal;
          bw = bwVal;
          bh = bhVal;
        }
        bx = left + (bw / 2);
        by = top + (bh / 2);
      }

      if (bw <= 0 || bh <= 0) return;

      console.log(`[Translator] Bubble #${index + 1}: "${text}" at (${Math.round(bx)}, ${Math.round(by)}) size ${Math.round(bw)}x${Math.round(bh)}`);

      // 2. Intelligent Background Color Detection (Dark speech bubbles vs Light speech bubbles)
      const isDark =
        b.background === 'black' ||
        b.background === 'dark' ||
        (b.background_color && (b.background_color.includes('black') || b.background_color.includes('dark')));

      const bgColor = isDark ? '#141416' : '#ffffff';
      const textColor = isDark ? '#ffffff' : '#0f172a';
      const strokeColor = isDark ? '#000000' : '#ffffff';

      // Detect if this is a sound effect (SFX) vs dialogue bubble
      const isSfx = Boolean(b.type === 'sfx' || b.is_sfx || b.background === 'transparent');

      ctx.save();

      // 3. Seamless background cover — use rounded rect for better bubble shape matching
      //    Expand slightly (4% padding) to ensure full coverage of original text
      const padX = bw * 0.04;
      const padY = bh * 0.04;
      const coverX = left - padX;
      const coverY = top - padY;
      const coverW = bw + padX * 2;
      const coverH = bh + padY * 2;

      // Determine shape: use ellipse for nearly-square or round bubbles, rounded-rect for wider/taller ones
      const aspectRatio = bw / bh;
      const isRoundish = aspectRatio > 0.65 && aspectRatio < 1.5 && bw < nw * 0.35;

      ctx.fillStyle = bgColor;
      ctx.beginPath();

      if (isSfx) {
        // SFX: no background fill — just render bold text with heavy stroke
        // Skip background
      } else if (isRoundish) {
        // Ellipse for round/oval speech bubbles
        const rx = coverW / 2;
        const ry = coverH / 2;
        ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Rounded rectangle for wide/tall bubbles (more common in manhwa)
        const cornerRadius = Math.min(12, Math.min(coverW, coverH) * 0.18);
        roundRect(ctx, coverX, coverY, coverW, coverH, cornerRadius);
        ctx.fill();
      }

      // 4. Add a very subtle feathered edge to blend with bubble (non-SFX only)
      if (!isSfx) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        if (isRoundish) {
          const outerRx = (coverW / 2) + 2;
          const outerRy = (coverH / 2) + 2;
          ctx.ellipse(bx, by, outerRx, outerRy, 0, 0, Math.PI * 2);
        } else {
          const cornerRadius = Math.min(12, Math.min(coverW, coverH) * 0.18) + 1;
          roundRect(ctx, coverX - 1, coverY - 1, coverW + 2, coverH + 2, cornerRadius);
        }
        // Create a very thin radial gradient at the edges for softness
        ctx.globalCompositeOperation = 'source-over';
      }

      // 5. Typeset dialogue with centered multiline word-wrapping
      //    Use larger usable width for text (88% of box width for rounded-rect, 78% for ellipse)
      const textAreaRatio = isRoundish ? 0.78 : 0.88;
      const maxLineWidth = Math.max(16, bw * textAreaRatio);
      const maxTextHeight = bh * (isRoundish ? 0.72 : 0.85);

      // Calculate ideal font size based on text length and box dimensions
      let fontSize;
      if (isSfx) {
        // SFX: bigger, bolder
        fontSize = Math.max(14, Math.min(48, Math.round(Math.min(bw, bh) * 0.45)));
      } else {
        // Dialogue: scale font based on available area
        const charCount = text.length;
        const areaSqrt = Math.sqrt(bw * bh);
        fontSize = Math.max(10, Math.min(32, Math.round(areaSqrt / Math.max(3, Math.sqrt(charCount) * 1.1))));
      }

      ctx.font = `bold ${fontSize}px "WildWords", "Comic Neue", "CC Wild Words", "Manga Temple", -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Word-wrap into lines
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

      // Auto-shrink font if text overflows vertically
      let lineHeight = fontSize * 1.22;
      let iterations = 0;
      while (lines.length * lineHeight > maxTextHeight && fontSize > 8 && iterations < 8) {
        fontSize = Math.max(8, fontSize - 1);
        ctx.font = `bold ${fontSize}px "WildWords", "Comic Neue", "CC Wild Words", "Manga Temple", -apple-system, sans-serif`;
        lineHeight = fontSize * 1.22;

        // Re-wrap with new font size
        lines = [];
        currentLine = '';
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
        iterations++;
      }

      const totalHeight = lines.length * lineHeight;
      const startY = by - (totalHeight / 2) + (lineHeight / 2);

      lines.forEach((line, idx) => {
        const curY = startY + (idx * lineHeight);

        if (isSfx) {
          // SFX: heavy black outline + white fill for impact lettering
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(4, fontSize * 0.18);
          ctx.lineJoin = 'round';
          ctx.strokeText(line, bx, curY, maxLineWidth);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(line, bx, curY, maxLineWidth);
        } else {
          // Dialogue: contrast stroke outline for clarity
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(2.5, fontSize * 0.12);
          ctx.lineJoin = 'round';
          ctx.strokeText(line, bx, curY, maxLineWidth);
          ctx.fillStyle = textColor;
          ctx.fillText(line, bx, curY, maxLineWidth);
        }
      });

      ctx.restore();

      // 6. Add interactive hover hotspot showing the original foreign text on hover
      if (b.raw_text) {
        const hotspot = document.createElement('div');
        hotspot.className = 'yomi-bubble-hotspot';
        hotspot.style.left = `${(bx - bw / 2) / nw * 100}%`;
        hotspot.style.top = `${(by - bh / 2) / nh * 100}%`;
        hotspot.style.width = `${(bw / nw) * 100}%`;
        hotspot.style.height = `${(bh / nh) * 100}%`;
        hotspot.title = `Original: ${b.raw_text}`;
        hotspotLayer.appendChild(hotspot);
      }
    });
  }

  // Helper: draw a rounded rectangle path
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
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

  // Context Menu trigger + Site Toggle message
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

    // Real-time site toggle from popup
    if (request.action === 'SITE_TOGGLE' && request.hostname === currentHostname) {
      siteEnabled = Boolean(request.enabled);
      if (siteEnabled) {
        // Site just enabled — scan for images
        scanImages();
      }
      sendResponse({ success: true });
    }
  });
})();
