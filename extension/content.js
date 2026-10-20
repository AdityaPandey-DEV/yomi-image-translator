// Yomi Manga & Comic Translator — Content Script v2.1.0
// Injects floating Yomi gates, in-image canvas translation, raw/translated toggle, and scroll listener.

(() => {
  const PROCESSED_ATTR = 'data-yomi-processed';
  let autoTranslate = false;
  let targetLang = 'en';
  let byok = {};

  // Sync settings
  function loadSettings() {
    chrome.storage.sync.get(['autoTranslate', 'targetLang', 'byok'], data => {
      autoTranslate = Boolean(data.autoTranslate);
      targetLang = data.targetLang || 'en';
      byok = data.byok || {};
    });
  }
  loadSettings();
  chrome.storage.onChanged.addListener(() => loadSettings());

  // IntersectionObserver for auto-translating manga strips on scroll
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

  // Scan for manga pages & panels
  function scanImages() {
    const images = document.querySelectorAll(`img:not([${PROCESSED_ATTR}])`);
    images.forEach(img => {
      // Manga pages are substantial images (exclude avatars, icons, banners)
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

    // Yomi Gate Hover Button
    const gateBtn = document.createElement('button');
    gateBtn.className = 'yomi-gate-button';
    gateBtn.title = 'Translate with Yomi';
    gateBtn.innerHTML = `
      <svg class="yomi-gate-svg" viewBox="0 0 24 24">
        <path d="M2 4h20v2H2V4zm2 3h16v1.5H4V7zm3 2.5h2V20H7V9.5zm8 0h2V20h-2V9.5zM3 2h18v1.5H3V2z"/>
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

    // Register with scroll observer
    scrollObserver.observe(img);
  }

  async function triggerTranslation(img, wrapperParam, gateBtnParam) {
    const wrapper = wrapperParam || img.closest('.yomi-manga-wrapper');
    const gateBtn = gateBtnParam || wrapper?.querySelector('.yomi-gate-button');

    // If already translated, toggle translated overlay vs raw
    if (img.dataset.yomiTranslated === 'true') {
      const overlay = wrapper?.querySelector('.yomi-overlay-canvas');
      const toggleBadge = wrapper?.querySelector('.yomi-toggle-badge');
      if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
        if (toggleBadge) toggleBadge.innerText = isHidden ? 'Translated' : 'Raw Scan';
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

      // Ask background service worker to process image
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

            // Append Toggle Badge in Bottom Right
            attachToggleBadge(wrapper, img);
          } else {
            throw new Error(response?.error || 'Translation failed');
          }
        }
      );
    } catch (err) {
      console.warn('[Yomi Translator]', err);
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

    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;

    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Erase text areas with speech bubble tone & render comic text
    bubbles.forEach(b => {
      ctx.save();

      // Clean interior of bubble
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.width / 2, b.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Typeset dialogue
      const text = (b.translated_text || '').toUpperCase();
      const fontSize = Math.max(12, Math.min(24, Math.round(b.width / 7.5)));
      ctx.font = `bold ${fontSize}px "Comic Neue", "Bangers", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Outline halo for readability
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, b.x, b.y, b.width * 0.88);

      // Foreground text
      ctx.fillStyle = '#000000';
      ctx.fillText(text, b.x, b.y, b.width * 0.88);

      ctx.restore();
    });
  }

  function attachToggleBadge(wrapper, img) {
    if (wrapper.querySelector('.yomi-toggle-badge')) return;

    const badge = document.createElement('button');
    badge.className = 'yomi-toggle-badge';
    badge.innerText = 'Translated (Click to toggle raw)';
    badge.title = 'Toggle raw Japanese/Korean vs translated English';

    badge.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = wrapper.querySelector('.yomi-overlay-canvas');
      if (overlay) {
        const isHidden = overlay.style.display === 'none';
        overlay.style.display = isHidden ? 'block' : 'none';
        badge.innerText = isHidden ? 'Translated' : 'Raw Scan';
      }
    });

    wrapper.appendChild(badge);
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
