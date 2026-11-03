// Yomi Image Translator - Content Script v2.2.0
// Clean-room, high-performance in-place overlay & comic typesetting.

(() => {
  const PROCESSED_ATTR = 'data-yomi-processed';
  let autoTranslate = false;
  let targetLang = 'en';
  let byok = {};

  function loadSettings() {
    chrome.storage.sync.get(['autoTranslate', 'targetLang', 'byok'], data => {
      autoTranslate = Boolean(data?.autoTranslate);
      targetLang = data?.targetLang || 'en';
      byok = data?.byok || {};
    });
  }
  loadSettings();
  chrome.storage.onChanged.addListener(() => loadSettings());

  // Scroll observer for auto-translating manga strips on scroll
  const scrollObserver = new IntersectionObserver(
    entries => {
      if (!autoTranslate) return;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.yomiGate === 'true' && !img.dataset.yomiTranslated && !img.dataset.yomiLoading) {
            triggerTranslation(img);
          }
        }
      });
    },
    { rootMargin: '300px 0px' }
  );

  function scanImages() {
    const images = document.querySelectorAll(`img:not([${PROCESSED_ATTR}])`);
    images.forEach(img => {
      const w = img.clientWidth || img.naturalWidth;
      const h = img.clientHeight || img.naturalHeight;

      if (w > 260 && h > 260) {
        attachYomiGate(img);
      } else {
        img.addEventListener(
          'load',
          () => {
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (nw > 260 && nh > 260) attachYomiGate(img);
          },
          { once: true }
        );
      }
    });
  }

  function attachYomiGate(img) {
    if (img.getAttribute(PROCESSED_ATTR)) return;
    img.setAttribute(PROCESSED_ATTR, 'true');

    // Create positioned wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'yomi-manga-wrapper';
    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    // Floating Translate Gate Button
    const gateBtn = document.createElement('button');
    gateBtn.className = 'yomi-gate-button';
    gateBtn.title = 'Translate with Yomi Image Translator';
    gateBtn.innerHTML = `
      <svg class="yomi-gate-svg" viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
      <span class="yomi-gate-text">Translate</span>
    `;

    gateBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      triggerTranslation(img, wrapper, gateBtn);
    });

    wrapper.appendChild(gateBtn);
    img.dataset.yomiGate = 'true';

    scrollObserver.observe(img);
  }

  async function triggerTranslation(img, wrapperParam, gateBtnParam) {
    const wrapper = wrapperParam || img.closest('.yomi-manga-wrapper');
    const gateBtn = gateBtnParam || wrapper?.querySelector('.yomi-gate-button');

    // If already translated, toggle between translated overlay and original image
    if (img.dataset.yomiTranslated === 'true') {
      const overlay = wrapper?.querySelector('.yomi-overlay-canvas');
      const toggleBadge = wrapper?.querySelector('.yomi-toggle-badge');
      if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
        if (toggleBadge) toggleBadge.innerText = isHidden ? 'Translated (Click for Raw)' : 'Raw Scan (Click to Translate)';
        if (gateBtn) gateBtn.classList.toggle('yomi-active', isHidden);
      }
      return;
    }

    if (img.dataset.yomiLoading === 'true') return;
    img.dataset.yomiLoading = 'true';

    if (gateBtn) {
      gateBtn.classList.add('yomi-loading');
      gateBtn.innerHTML = `<div class="yomi-spinner"></div><span>Translating...</span>`;
    }

    try {
      const src = img.currentSrc || img.src;

      chrome.runtime.sendMessage(
        {
          action: 'TRANSLATE_PAYLOAD',
          data: {
            imageUrl: src,
            targetLang,
            byok,
          },
        },
        response => {
          img.dataset.yomiLoading = 'false';

          if (response?.success && response.result?.bubbles) {
            renderOverlay(img, wrapper, response.result.bubbles);
            img.dataset.yomiTranslated = 'true';

            if (gateBtn) {
              gateBtn.classList.remove('yomi-loading');
              gateBtn.classList.add('yomi-active');
              gateBtn.innerHTML = `
                <svg class="yomi-gate-svg" viewBox="0 0 24 24">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
                <span>Translated</span>
              `;
            }

            attachToggleBadge(wrapper, img);
          } else {
            const errorMsg = response?.error || 'Translation failed';
            showNotice(wrapper, `Yomi Notice: ${errorMsg}`);
            if (gateBtn) {
              gateBtn.classList.remove('yomi-loading');
              gateBtn.innerHTML = `<span>Retry</span>`;
            }
          }
        }
      );
    } catch (err) {
      console.warn('[Yomi]', err);
      img.dataset.yomiLoading = 'false';
      if (gateBtn) {
        gateBtn.classList.remove('yomi-loading');
        gateBtn.innerHTML = `<span>Retry</span>`;
      }
    }
  }

  function renderOverlay(img, wrapper, bubbles) {
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

      // 1. Inpaint bubble background cleanly
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(bx, by, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Typeset translated text inside bubble with multiline wrapping
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

      // Adjust font size if total text exceeds height
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
        // White halo stroke for maximum clarity
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, bx, curY, maxLineWidth);

        // Crisp black lettering
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

  function showNotice(wrapper, message) {
    const existing = wrapper.querySelector('.yomi-notice-pill');
    if (existing) existing.remove();

    const pill = document.createElement('div');
    pill.className = 'yomi-notice-pill';
    pill.innerText = message;
    wrapper.appendChild(pill);

    setTimeout(() => {
      pill.style.opacity = '0';
      setTimeout(() => pill.remove(), 400);
    }, 4000);
  }

  // Observe dynamically loaded images (infinite scroll manga readers)
  const mutationObserver = new MutationObserver(() => scanImages());
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  // Initial pass
  scanImages();

  // Listen for context menu triggers
  chrome.runtime.onMessage.addListener(request => {
    if (request.action === 'TRANSLATE_IMAGE_SRC') {
      const match = Array.from(document.querySelectorAll('img')).find(
        i => (i.currentSrc || i.src) === request.srcUrl
      );
      if (match) {
        const wrapper = match.closest('.yomi-manga-wrapper');
        const gateBtn = wrapper?.querySelector('.yomi-gate-button');
        triggerTranslation(match, wrapper, gateBtn);
      }
    }
  });
})();
