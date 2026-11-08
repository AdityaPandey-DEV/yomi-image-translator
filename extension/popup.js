// ============================================================
// Manga & Manhwa Image Translator — Extension Popup v2.0.0
// Database as Single Source of Truth via /api/user Endpoint
// Features:
// 1. Bidirectional Sign-Out (Extension ↔ Website sync)
// 2. Translation Mode Switcher (Private vs Shared Pool)
// 3. Cloud API Key Vault (List, Add, Delete with mask)
// 4. Per-User Database Settings (Auto-Translate default OFF, Target Lang)
// 5. Zero plain-text key storage in extension
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Purge legacy plaintext storage keys
  chrome.storage.sync.remove(['byok', 'googleApiKey', 'openaiApiKey', 'anthropicApiKey', 'openrouterApiKey', 'groqApiKey', 'deepseekApiKey']);
  chrome.storage.local.remove(['byok', 'googleApiKey', 'openaiApiKey', 'anthropicApiKey', 'openrouterApiKey', 'groqApiKey', 'deepseekApiKey']);

  const BASE_URL = 'https://manga-manhwa-translator.vercel.app';
  const PORTAL_PATTERN = '*://manga-manhwa-translator.vercel.app/*';

  // DOM Elements
  const signedOutView = document.getElementById('signed-out-view');
  const signedInView = document.getElementById('signed-in-view');
  const signinActionBtn = document.getElementById('signin-action-btn');
  const syncDetectionStatus = document.getElementById('sync-detection-status');

  const userNameEl = document.getElementById('user-name');
  const userEmailEl = document.getElementById('user-email');
  const userAvatarContainer = document.getElementById('user-avatar-container');
  const modeBadgeEl = document.getElementById('mode-badge');

  const modePrivateCard = document.getElementById('mode-private-card');
  const modeSharedCard = document.getElementById('mode-shared-card');

  const keysLoading = document.getElementById('keys-loading');
  const keysList = document.getElementById('keys-list');
  const btnAddKey = document.getElementById('btn-add-key');
  const addKeyForm = document.getElementById('add-key-form');
  const keyProviderSelect = document.getElementById('key-provider');
  const keyInput = document.getElementById('key-input');
  const keyGetLink = document.getElementById('key-get-link');
  const keyModelInput = document.getElementById('key-model');
  const keyFormError = document.getElementById('key-form-error');
  const btnSaveKey = document.getElementById('btn-save-key');
  const btnCancelKey = document.getElementById('btn-cancel-key');

  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  const signoutBtn = document.getElementById('signout-btn');

  // Provider configuration
  const PROVIDERS = {
    google: {
      name: 'Google Gemini',
      icon: '✨',
      defaultModel: 'gemini-2.5-flash',
      placeholder: 'AIzaSy...',
      link: 'https://aistudio.google.com/app/apikey',
      linkText: 'Get Free Key from Google AI Studio ↗',
    },
    openrouter: {
      name: 'OpenRouter',
      icon: '🌐',
      defaultModel: 'google/gemini-2.5-flash',
      placeholder: 'sk-or-v1-...',
      link: 'https://openrouter.ai/keys',
      linkText: 'Get Key from OpenRouter ↗',
    },
    openai: {
      name: 'OpenAI',
      icon: '🤖',
      defaultModel: 'gpt-4o-mini',
      placeholder: 'sk-proj-...',
      link: 'https://platform.openai.com/api-keys',
      linkText: 'Get Key from OpenAI ↗',
    },
    anthropic: {
      name: 'Anthropic Claude',
      icon: '🧠',
      defaultModel: 'claude-3-5-haiku-20241022',
      placeholder: 'sk-ant-...',
      link: 'https://console.anthropic.com/settings/keys',
      linkText: 'Get Key from Anthropic ↗',
    },
    groq: {
      name: 'Groq',
      icon: '⚡',
      defaultModel: 'llama-3.2-11b-vision-preview',
      placeholder: 'gsk_...',
      link: 'https://console.groq.com/keys',
      linkText: 'Get Key from Groq ↗',
    },
    deepseek: {
      name: 'DeepSeek',
      icon: '🐋',
      defaultModel: 'deepseek-chat',
      placeholder: 'sk-...',
      link: 'https://platform.deepseek.com/api_keys',
      linkText: 'Get Key from DeepSeek ↗',
    },
  };

  let currentToken = null;
  let currentMode = 'private';

  // ============================================================
  // 1. Initial State & Sync
  // ============================================================

  function checkAuthState() {
    chrome.storage.local.get(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode'],
      async data => {
        if (!data.firebaseToken) {
          showSignedOut();
          runAutoSync();
          return;
        }

        currentToken = data.firebaseToken;
        currentMode = data.userMode || 'private';
        showSignedIn(data);

        // Fetch fresh database state (single source of truth)
        await loadUserDataFromDatabase();
      }
    );
  }

  function showSignedOut() {
    signedOutView.style.display = 'block';
    signedInView.style.display = 'none';
  }

  function showSignedIn(localData) {
    signedOutView.style.display = 'none';
    signedInView.style.display = 'block';

    const email = localData.userEmail || 'user@email.com';
    const name = localData.userName || email.split('@')[0];
    const photo = localData.userPhoto;

    userNameEl.textContent = name;
    userEmailEl.textContent = email;

    if (photo) {
      userAvatarContainer.innerHTML = `<img src="${photo}" alt="${name}">`;
    } else {
      const initial = (name[0] || email[0] || 'U').toUpperCase();
      userAvatarContainer.innerHTML = `<span>${initial}</span>`;
    }

    updateModeUI(localData.userMode || 'private');
  }

  function updateModeUI(mode) {
    currentMode = mode;
    if (mode === 'shared') {
      modeSharedCard?.classList.add('active');
      modePrivateCard?.classList.remove('active');
      if (modeBadgeEl) {
        modeBadgeEl.textContent = 'Shared Pool';
        modeBadgeEl.className = 'mode-pill mode-shared';
      }
    } else {
      modePrivateCard?.classList.add('active');
      modeSharedCard?.classList.remove('active');
      if (modeBadgeEl) {
        modeBadgeEl.textContent = 'Private Vault';
        modeBadgeEl.className = 'mode-pill mode-private';
      }
    }
  }

  // ============================================================
  // 2. Fetch User Profile & Keys from Database (/api/user)
  // ============================================================

  async function loadUserDataFromDatabase() {
    if (!currentToken) return;

    if (keysLoading) keysLoading.classList.add('visible');

    try {
      const res = await fetch(`${BASE_URL}/api/user`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (res.status === 401) {
        // Session expired, prompt sign-in
        handleSignOut(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to load data: ${res.status}`);
      }

      const data = await res.json();
      const profile = data.profile || {};
      const keys = data.keys || [];

      // Update Mode
      if (profile.mode) {
        updateModeUI(profile.mode);
        chrome.storage.local.set({ userMode: profile.mode });
      }

      // Update Auto-Translate (Default FALSE / OFF per database)
      const isAutoTranslate = Boolean(profile.autoTranslate);
      if (autoTranslateToggle) {
        autoTranslateToggle.checked = isAutoTranslate;
      }
      chrome.storage.sync.set({ autoTranslate: isAutoTranslate });

      // Update Target Language (Default 'en' per database)
      const lang = profile.targetLang || 'en';
      if (targetLangSelect) {
        targetLangSelect.value = lang;
      }
      chrome.storage.sync.set({ targetLang: lang });

      // Render API Key Vault list
      renderKeysList(keys);
    } catch (err) {
      console.warn('[Popup] Error loading user database:', err);
    } finally {
      if (keysLoading) keysLoading.classList.remove('visible');
    }
  }

  // Render API keys in vault
  function renderKeysList(keys) {
    if (!keysList) return;

    if (!keys || keys.length === 0) {
      keysList.innerHTML = `
        <div style="text-align:center; padding:12px 6px; color:var(--dim); font-size:11px;">
          No API keys in your vault yet.<br>Click below to add your key.
        </div>
      `;
      return;
    }

    keysList.innerHTML = keys
      .map(k => {
        const provInfo = PROVIDERS[k.provider] || { name: k.provider, icon: '🔑' };
        return `
          <div class="key-item" data-provider="${k.provider}">
            <div class="key-icon">${provInfo.icon}</div>
            <div class="key-info">
              <div class="key-provider">${provInfo.name}</div>
              <div class="key-meta">
                <span class="key-masked">${k.maskedKey}</span>
                <span>•</span>
                <span>${k.model || 'auto'}</span>
              </div>
            </div>
            <button class="key-delete-btn" data-provider="${k.provider}" title="Delete Key">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
      })
      .join('');

    // Attach delete listeners
    keysList.querySelectorAll('.key-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const provider = btn.getAttribute('data-provider');
        if (!provider || !currentToken) return;

        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-sm" style="width:10px;height:10px;"></div>`;

        try {
          const res = await fetch(`${BASE_URL}/api/user?provider=${encodeURIComponent(provider)}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${currentToken}`,
            },
          });

          if (res.ok) {
            await loadUserDataFromDatabase();
          } else {
            alert('Failed to delete key. Please try again.');
          }
        } catch (err) {
          console.error('[Popup] Delete key error:', err);
        }
      });
    });
  }

  // ============================================================
  // 3. Translation Mode Switching (Updates Database)
  // ============================================================

  if (modePrivateCard) {
    modePrivateCard.addEventListener('click', () => switchMode('private'));
  }
  if (modeSharedCard) {
    modeSharedCard.addEventListener('click', () => switchMode('shared'));
  }

  async function switchMode(newMode) {
    if (!currentToken || currentMode === newMode) return;

    updateModeUI(newMode);
    chrome.storage.local.set({ userMode: newMode });

    try {
      await fetch(`${BASE_URL}/api/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.warn('[Popup] Failed to sync mode to database:', err);
    }
  }

  // ============================================================
  // 4. API Key Vault Form (Add New Key)
  // ============================================================

  if (btnAddKey) {
    btnAddKey.addEventListener('click', () => {
      addKeyForm?.classList.add('visible');
      btnAddKey.style.display = 'none';
      updateProviderFormUI();
    });
  }

  if (btnCancelKey) {
    btnCancelKey.addEventListener('click', () => {
      addKeyForm?.classList.remove('visible');
      if (btnAddKey) btnAddKey.style.display = 'flex';
      if (keyInput) keyInput.value = '';
      if (keyFormError) keyFormError.style.display = 'none';
    });
  }

  if (keyProviderSelect) {
    keyProviderSelect.addEventListener('change', updateProviderFormUI);
  }

  function updateProviderFormUI() {
    const prov = keyProviderSelect?.value || 'google';
    const info = PROVIDERS[prov] || PROVIDERS.google;

    if (keyInput) keyInput.placeholder = info.placeholder;
    if (keyModelInput) keyModelInput.value = info.defaultModel;
    if (keyGetLink) {
      keyGetLink.href = info.link;
      keyGetLink.textContent = info.linkText;
    }
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', async () => {
      const provider = keyProviderSelect?.value || 'google';
      const apiKeyVal = keyInput?.value?.trim();
      const modelVal = keyModelInput?.value?.trim() || PROVIDERS[provider]?.defaultModel;

      if (!apiKeyVal) {
        showKeyError('Please enter an API key.');
        return;
      }

      if (!currentToken) {
        showKeyError('Authentication token missing. Please sign in.');
        return;
      }

      btnSaveKey.disabled = true;
      btnSaveKey.textContent = 'Saving…';
      if (keyFormError) keyFormError.style.display = 'none';

      try {
        const res = await fetch(`${BASE_URL}/api/user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({
            provider,
            apiKey: apiKeyVal,
            model: modelVal,
            isShared: currentMode === 'shared',
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to save key.');
        }

        // Key saved! Reset form & refresh keys list
        if (keyInput) keyInput.value = '';
        addKeyForm?.classList.remove('visible');
        if (btnAddKey) btnAddKey.style.display = 'flex';
        await loadUserDataFromDatabase();
      } catch (err) {
        showKeyError(err.message || 'Error saving key.');
      } finally {
        btnSaveKey.disabled = false;
        btnSaveKey.textContent = 'Save Key';
      }
    });
  }

  function showKeyError(msg) {
    if (!keyFormError) return;
    keyFormError.textContent = msg;
    keyFormError.style.display = 'block';
  }

  // ============================================================
  // 5. Settings: Auto-Translate & Target Language (Database Synced)
  // ============================================================

  if (autoTranslateToggle) {
    autoTranslateToggle.addEventListener('change', async () => {
      const checked = autoTranslateToggle.checked;
      chrome.storage.sync.set({ autoTranslate: checked });

      if (currentToken) {
        try {
          await fetch(`${BASE_URL}/api/user`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentToken}`,
            },
            body: JSON.stringify({ autoTranslate: checked }),
          });
        } catch (err) {
          console.warn('[Popup] Error saving autoTranslate to database:', err);
        }
      }
    });
  }

  if (targetLangSelect) {
    targetLangSelect.addEventListener('change', async () => {
      const lang = targetLangSelect.value;
      chrome.storage.sync.set({ targetLang: lang });

      if (currentToken) {
        try {
          await fetch(`${BASE_URL}/api/user`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentToken}`,
            },
            body: JSON.stringify({ targetLang: lang }),
          });
        } catch (err) {
          console.warn('[Popup] Error saving targetLang to database:', err);
        }
      }
    });
  }

  // ============================================================
  // 6. Bidirectional Sign-Out (Extension → Website)
  // ============================================================

  if (signoutBtn) {
    signoutBtn.addEventListener('click', () => handleSignOut(true));
  }

  async function handleSignOut(propagateToWebsite = true) {
    // 1. Clear extension local storage
    chrome.storage.local.remove(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode', 'authTimestamp'],
      () => {
        currentToken = null;
        showSignedOut();
      }
    );

    // 2. Propagate to open website tabs
    if (propagateToWebsite && chrome.tabs?.query) {
      chrome.tabs.query({ url: PORTAL_PATTERN }, tabs => {
        if (!tabs || tabs.length === 0) return;

        tabs.forEach(tab => {
          // Tell content script to sign out
          chrome.tabs.sendMessage(tab.id, { action: 'FORCE_WEBSITE_SIGNOUT' }, () => {
            if (chrome.runtime.lastError) {
              // Content script unreachable, use direct scripting fallback
              tryScriptSignOut(tab.id);
            }
          });
        });
      });
    }
  }

  function tryScriptSignOut(tabId) {
    if (!chrome.scripting?.executeScript) return;
    try {
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          localStorage.removeItem('mmt_auth_session');
          window.dispatchEvent(new CustomEvent('mmt-extension-signout'));
        },
      });
    } catch (_) {}
  }

  // ============================================================
  // 7. Auto-Sync & Connect Button
  // ============================================================

  if (signinActionBtn) {
    signinActionBtn.addEventListener('click', async () => {
      const portalTab = await findPortalTab();
      if (portalTab) {
        chrome.tabs.update(portalTab.id, { active: true });
        if (portalTab.windowId) {
          chrome.windows.update(portalTab.windowId, { focused: true });
        }
        chrome.tabs.reload(portalTab.id);
        setSyncStatusText('syncing');

        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === portalTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => runAutoSync(), 800);
          }
        });
      } else {
        chrome.tabs.create({ url: `${BASE_URL}/` });
      }
    });
  }

  if (openDashboardBtn) {
    openDashboardBtn.addEventListener('click', async () => {
      const portalTab = await findPortalTab();
      if (portalTab) {
        chrome.tabs.update(portalTab.id, { active: true });
        if (portalTab.windowId) {
          chrome.windows.update(portalTab.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: `${BASE_URL}/` });
      }
    });
  }

  async function runAutoSync() {
    setSyncStatusText('checking');
    const portalTab = await findPortalTab();
    if (!portalTab) {
      setSyncStatusText('offline');
      return;
    }

    setSyncStatusText('syncing');

    // Try Layer 2: Content script
    const csSuccess = await new Promise(resolve => {
      const t = setTimeout(() => resolve(false), 1500);
      try {
        chrome.tabs.sendMessage(portalTab.id, { action: 'REQUEST_AUTH_FROM_PAGE' }, res => {
          clearTimeout(t);
          if (chrome.runtime.lastError) resolve(false);
          else resolve(res?.success || false);
        });
      } catch {
        clearTimeout(t);
        resolve(false);
      }
    });

    if (csSuccess) {
      await sleep(250);
      chrome.storage.local.get(['firebaseToken'], res => {
        if (res.firebaseToken) checkAuthState();
      });
      return;
    }

    // Try Layer 3: Scripting localStorage recovery
    if (chrome.scripting?.executeScript) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: portalTab.id },
          func: () => {
            try {
              const raw = localStorage.getItem('mmt_auth_session');
              if (raw) return JSON.parse(raw);
            } catch (_) {}
            return null;
          },
        });

        if (results && results[0]?.result?.token) {
          const sess = results[0].result;
          await new Promise(r =>
            chrome.storage.local.set(
              {
                firebaseToken: sess.token,
                userEmail: sess.email || '',
                userName: sess.displayName || '',
                userPhoto: sess.photoURL || '',
                userMode: sess.mode || 'private',
                authTimestamp: Date.now(),
              },
              r
            )
          );
          checkAuthState();
          return;
        }
      } catch (_) {}
    }

    setSyncStatusText('refresh_needed');
  }

  function setSyncStatusText(state) {
    if (!syncDetectionStatus) return;
    const states = {
      checking: `<div class="spinner-sm"></div><span>Checking for active session…</span>`,
      syncing: `<div class="spinner-sm"></div><span>Syncing session from portal…</span>`,
      offline: `<span>Portal offline. Click above to sign in.</span>`,
      refresh_needed: `<span style="color:#fbbf24;">↻ Portal open — please refresh tab to reconnect.</span>`,
    };
    syncDetectionStatus.innerHTML = states[state] || states.offline;
  }

  // Reactive Storage Listener
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.firebaseToken || changes.userMode)) {
      checkAuthState();
    }
  });

  // Helpers
  function findPortalTab() {
    return new Promise(resolve => {
      if (!chrome.tabs?.query) { resolve(null); return; }
      chrome.tabs.query({ url: PORTAL_PATTERN }, tabs => {
        resolve(tabs && tabs.length > 0 ? tabs[0] : null);
      });
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Run on start
  checkAuthState();
});
