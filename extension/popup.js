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
  const keyModelSelect = document.getElementById('key-model-select');
  const modelStatusIndicator = document.getElementById('model-status-indicator');
  const modelSelectWrapper = document.getElementById('model-select-wrapper');
  const modelCustomWrapper = document.getElementById('model-custom-wrapper');
  const keyCustomModel = document.getElementById('key-custom-model');
  const btnBackToModels = document.getElementById('btn-back-to-models');
  const shareKeyWrapper = document.getElementById('share-key-wrapper');
  const keyShareCheckbox = document.getElementById('key-share-checkbox');
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

  // Static curated models matching website's getStaticCuratedModels
  const CURATED_MODELS = {
    google: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Recommended · Fastest Frontier Vision)' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Lowest Latency & Budget)' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Advanced Logic & Hard Dialogue)' },
      { id: 'gemini-3.0-pro', name: 'Gemini 3.0 Pro (Frontier Multimodal)' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Proven High-Speed Stable)' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deep Visual Reasoning)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Stable Workhorse)' },
    ],
    openrouter: [
      { id: 'google/gemini-3.5-flash', name: 'Google Gemini 3.5 Flash (Frontier & Fast)' },
      { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'openai/gpt-4o', name: 'GPT-4o Flagship' },
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
      { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
    ],
    openai: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Budget Multimodal)' },
      { id: 'gpt-4o', name: 'GPT-4o (Omni Multimodal Standard)' },
      { id: 'gpt-4.5', name: 'GPT-4.5 (Frontier Deep Visual Intuition)' },
      { id: 'o3-mini', name: 'o3-mini (High-Speed Reasoning)' },
    ],
    anthropic: [
      { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5 (Flagship Balanced)' },
      { id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5 (Ultra Fast Vision)' },
      { id: 'claude-opus-5.5', name: 'Claude Opus 5.5 (Frontier Reasoning)' },
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Classic)' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Classic)' },
    ],
    groq: [
      { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision (Ultra Fast)' },
      { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision (High Capacity)' },
    ],
    deepseek: [
      { id: 'deepseek-chat', name: 'DeepSeek V3 (Fast Multilingual Reasoning)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Advanced Chain of Thought)' },
    ],
  };

  let currentToken = null;
  let currentMode = 'private';

  // Model selection state (matching Dashboard.tsx)
  let dynamicModels = CURATED_MODELS.google;
  let selectedModel = CURATED_MODELS.google[0].id;
  let isLiveModels = false;
  let isLoadingModels = false;
  let isCustomModel = false;
  let modelDiscoveryTimer = null;

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
          <div class="key-item" data-key-id="${k.id}">
            <div class="key-icon">${provInfo.icon}</div>
            <div class="key-info">
              <div class="key-provider">${provInfo.name}</div>
              <div class="key-meta">
                <span class="key-masked">${k.maskedKey}</span>
                <span>•</span>
                <span>${k.model || 'auto'}</span>
              </div>
            </div>
            <button class="key-delete-btn" data-key-id="${k.id}" title="Delete Key">
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
        const keyId = btn.getAttribute('data-key-id');
        if (!keyId || !currentToken) return;

        btn.disabled = true;
        btn.innerHTML = `<div class="spinner-sm" style="width:10px;height:10px;"></div>`;

        try {
          const res = await fetch(`${BASE_URL}/api/user?provider=${encodeURIComponent(keyId)}`, {
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
  // 4. API Key Vault Form (Add New Key with Model Dropdown)
  // Matching Dashboard.tsx & BYOKModal.tsx approach exactly
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

  // Model select change listener
  if (keyModelSelect) {
    keyModelSelect.addEventListener('change', () => {
      if (keyModelSelect.value === '__custom__') {
        isCustomModel = true;
        if (keyCustomModel) keyCustomModel.value = '';
        renderModelSection();
        if (keyCustomModel) keyCustomModel.focus();
      } else {
        selectedModel = keyModelSelect.value;
      }
    });
  }

  // Back to list button from custom input
  if (btnBackToModels) {
    btnBackToModels.addEventListener('click', () => {
      isCustomModel = false;
      if (dynamicModels[0]) selectedModel = dynamicModels[0].id;
      renderModelSection();
    });
  }

  // Render model selection section (matches Dashboard.tsx)
  function renderModelSection() {
    // 1. Status Indicator
    if (modelStatusIndicator) {
      if (isLoadingModels) {
        modelStatusIndicator.innerHTML = `
          <span style="display:inline-flex; align-items:center; gap:4px; color:var(--primary);">
            <div class="spinner-sm" style="width:9px; height:9px;"></div> Discovering…
          </span>
        `;
      } else if (isLiveModels) {
        modelStatusIndicator.innerHTML = `
          <span style="display:inline-flex; align-items:center; gap:4px; color:#4ade80;">
            <span style="width:5px; height:5px; border-radius:50%; background:#4ade80; box-shadow:0 0 6px #4ade80;"></span>
            Live API Verified (${dynamicModels.length})
          </span>
        `;
      } else {
        modelStatusIndicator.innerHTML = `
          <button type="button" id="btn-check-live-models" style="background:transparent; border:none; color:var(--muted); font-size:10px; cursor:pointer; text-decoration:underline;">
            Check live models
          </button>
        `;
        const btnCheck = document.getElementById('btn-check-live-models');
        if (btnCheck) {
          btnCheck.addEventListener('click', (e) => {
            e.preventDefault();
            fetchLiveModelsForForm();
          });
        }
      }
    }

    // 2. Select vs Custom Mode
    if (isCustomModel) {
      if (modelSelectWrapper) modelSelectWrapper.style.display = 'none';
      if (modelCustomWrapper) modelCustomWrapper.style.display = 'block';
    } else {
      if (modelSelectWrapper) modelSelectWrapper.style.display = 'block';
      if (modelCustomWrapper) modelCustomWrapper.style.display = 'none';

      if (keyModelSelect) {
        keyModelSelect.innerHTML = dynamicModels
          .map(m => `<option value="${m.id}">${m.name}</option>`)
          .join('') + `<option value="__custom__">+ Enter custom model ID...</option>`;

        if (dynamicModels.some(m => m.id === selectedModel)) {
          keyModelSelect.value = selectedModel;
        } else if (dynamicModels[0]) {
          selectedModel = dynamicModels[0].id;
          keyModelSelect.value = selectedModel;
        }
      }
    }
  }

  // Live dynamic model discovery matching website
  async function fetchLiveModelsForForm() {
    const prov = keyProviderSelect?.value || 'google';
    const keyVal = keyInput?.value?.trim() || '';

    isLoadingModels = true;
    renderModelSection();

    try {
      const res = await fetch(`${BASE_URL}/api/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: prov, apiKey: keyVal }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          dynamicModels = data.models;
          isLiveModels = Boolean(data.isLive);
          if (!dynamicModels.some(m => m.id === selectedModel)) {
            selectedModel = dynamicModels[0].id;
          }
        }
      }
    } catch (err) {
      console.warn('[Popup] Model discovery error:', err);
    } finally {
      isLoadingModels = false;
      renderModelSection();
    }
  }

  function triggerModelDiscoveryDebounced(delay = 600) {
    clearTimeout(modelDiscoveryTimer);
    modelDiscoveryTimer = setTimeout(() => {
      fetchLiveModelsForForm();
    }, delay);
  }

  if (keyInput) {
    keyInput.addEventListener('input', () => {
      triggerModelDiscoveryDebounced(keyInput.value ? 600 : 0);
    });
  }

  function updateProviderFormUI() {
    const prov = keyProviderSelect?.value || 'google';
    const info = PROVIDERS[prov] || PROVIDERS.google;

    if (keyInput) keyInput.placeholder = info.placeholder;
    if (keyGetLink) {
      keyGetLink.href = info.link;
      keyGetLink.textContent = info.linkText;
    }

    // Reset models for this provider to curated list
    dynamicModels = CURATED_MODELS[prov] || CURATED_MODELS.google;
    selectedModel = dynamicModels[0]?.id || '';
    isLiveModels = false;
    isLoadingModels = false;
    isCustomModel = false;

    // Show share checkbox in shared mode (matching website)
    if (shareKeyWrapper) {
      shareKeyWrapper.style.display = currentMode === 'shared' ? 'block' : 'none';
    }

    renderModelSection();
    triggerModelDiscoveryDebounced(0); // Immediately fetch live models if endpoint available
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', async () => {
      const provider = keyProviderSelect?.value || 'google';
      const apiKeyVal = keyInput?.value?.trim();
      const finalModel = isCustomModel ? keyCustomModel?.value?.trim() : selectedModel;

      if (!apiKeyVal) {
        showKeyError('Please enter an API key.');
        return;
      }

      if (!finalModel) {
        showKeyError('Please select or enter a model ID.');
        return;
      }

      if (!currentToken) {
        showKeyError('Authentication token missing. Please sign in.');
        return;
      }

      const isSharedKey = currentMode === 'shared' && Boolean(keyShareCheckbox?.checked);

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
            model: finalModel,
            isShared: isSharedKey,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to save key.');
        }

        // Key saved! Reset form & refresh keys list from database
        if (keyInput) keyInput.value = '';
        if (keyCustomModel) keyCustomModel.value = '';
        isCustomModel = false;
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
