// ============================================================
// Manga & Manhwa Image Translator — Popup v2.0.0
// Professional 3-Layer Auth Sync Architecture
//
// Layer 1 (PRIMARY):  chrome.storage.local — already synced by
//   externally_connectable (website → background.js direct).
//   Popup just reads it. Zero network dependency.
//
// Layer 2 (BACKUP):   If storage is empty, ask the content script
//   on the portal tab to relay auth from the webpage DOM.
//   Gracefully handles orphaned content scripts.
//
// Layer 3 (RECOVERY): If content script is dead (extension reload),
//   use chrome.scripting.executeScript to directly read
//   localStorage from the portal tab. Bulletproof fallback.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Purge legacy plaintext API keys
  chrome.storage.sync.remove(['byok', 'googleApiKey', 'openaiApiKey', 'anthropicApiKey', 'openrouterApiKey', 'groqApiKey', 'deepseekApiKey']);
  chrome.storage.local.remove(['byok', 'googleApiKey', 'openaiApiKey', 'anthropicApiKey', 'openrouterApiKey', 'groqApiKey', 'deepseekApiKey']);

  // DOM References
  const signedOutView = document.getElementById('signed-out-view');
  const signedInView = document.getElementById('signed-in-view');
  const userNameEl = document.getElementById('user-name');
  const userEmailEl = document.getElementById('user-email');
  const userAvatarContainer = document.getElementById('user-avatar-container');
  const modeBadgeEl = document.getElementById('mode-badge');
  const signinActionBtn = document.getElementById('signin-action-btn');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const syncDetectionStatus = document.getElementById('sync-detection-status');
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');

  const PORTAL_URL = 'https://manga-manhwa-translator.vercel.app/';
  const PORTAL_PATTERN = '*://manga-manhwa-translator.vercel.app/*';

  // ============================================================
  // 1. Update UI from stored auth state
  // ============================================================
  function renderAuthState() {
    chrome.storage.local.get(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode'],
      data => {
        if (!data.firebaseToken) {
          signedOutView.style.display = 'block';
          signedInView.style.display = 'none';
          runAuthSync(); // Attempt to recover auth
          return;
        }

        // Authenticated — show signed-in UI
        signedOutView.style.display = 'none';
        signedInView.style.display = 'block';
        setSyncStatus('connected');

        const email = data.userEmail || 'user@email.com';
        const name = data.userName || email.split('@')[0];
        const photo = data.userPhoto;
        const mode = data.userMode || 'private';

        userNameEl.textContent = name;
        userEmailEl.textContent = email;

        if (photo) {
          userAvatarContainer.innerHTML = `<img src="${photo}" alt="${name}">`;
        } else {
          const initial = (name[0] || email[0] || 'U').toUpperCase();
          userAvatarContainer.innerHTML = `<span>${initial}</span>`;
        }

        if (mode === 'shared') {
          modeBadgeEl.textContent = 'Shared Pool';
          modeBadgeEl.className = 'mode-pill mode-shared';
        } else {
          modeBadgeEl.textContent = 'Private Vault';
          modeBadgeEl.className = 'mode-pill mode-private';
        }
      }
    );

    // Load user preferences
    chrome.storage.sync.get(['autoTranslate', 'targetLang'], data => {
      if (data.autoTranslate !== undefined) {
        autoTranslateToggle.checked = Boolean(data.autoTranslate);
      }
      if (data.targetLang) {
        targetLangSelect.value = data.targetLang;
      }
    });
  }

  // ============================================================
  // 2. Sync Status UI Helper
  // ============================================================
  function setSyncStatus(state, detail) {
    if (!syncDetectionStatus) return;

    const STATES = {
      checking: `
        <div class="spinner-sm"></div>
        <span>Checking for active session…</span>
      `,
      syncing: `
        <div class="spinner-sm"></div>
        <span>Syncing session from portal…</span>
      `,
      connected: `
        <span style="color:#4ade80;">✓ Session synced</span>
      `,
      offline: `
        <span>No active portal session. Click above to sign in.</span>
      `,
      recovery: `
        <div class="spinner-sm"></div>
        <span>Recovering session…</span>
      `,
      error: `
        <span style="color:#f87171;">⚠ ${detail || 'Could not sync. Please refresh your portal tab.'}</span>
      `,
      refresh_needed: `
        <span style="color:#fbbf24;">↻ Portal open — please refresh the tab to reconnect.</span>
      `,
    };

    syncDetectionStatus.innerHTML = STATES[state] || STATES.offline;
  }

  // ============================================================
  // 3. Three-Layer Auth Recovery
  // ============================================================
  async function runAuthSync() {
    // First, check if we already have a token (Layer 1)
    const stored = await getFromStorage('firebaseToken');
    if (stored) {
      renderAuthState();
      return;
    }

    setSyncStatus('checking');

    // Find portal tab
    const portalTab = await findPortalTab();
    if (!portalTab) {
      setSyncStatus('offline');
      return;
    }

    // Layer 2: Try content script message relay
    setSyncStatus('syncing');
    const contentScriptSuccess = await tryContentScriptSync(portalTab.id);
    if (contentScriptSuccess) {
      // Give storage a moment to write, then re-render
      await sleep(200);
      const token = await getFromStorage('firebaseToken');
      if (token) {
        renderAuthState();
        return;
      }
    }

    // Layer 3: Recovery via chrome.scripting.executeScript
    setSyncStatus('recovery');
    const recoverySuccess = await tryScriptInjectionRecovery(portalTab.id);
    if (recoverySuccess) {
      await sleep(200);
      const token = await getFromStorage('firebaseToken');
      if (token) {
        renderAuthState();
        return;
      }
    }

    // All layers failed — content script is dead and localStorage is empty
    setSyncStatus('refresh_needed');
  }

  // ============================================================
  // Layer 2: Content Script Message Relay
  // ============================================================
  function tryContentScriptSync(tabId) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 2000);

      try {
        chrome.tabs.sendMessage(tabId, { action: 'REQUEST_AUTH_FROM_PAGE' }, response => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            // Content script is dead (extension was reloaded)
            console.log('[Popup] Content script unreachable:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          resolve(response?.success || false);
        });
      } catch (e) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  // ============================================================
  // Layer 3: Direct localStorage Recovery via chrome.scripting
  // ============================================================
  async function tryScriptInjectionRecovery(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Executed in the webpage context — reads localStorage
          try {
            const raw = localStorage.getItem('mmt_auth_session');
            if (raw) return JSON.parse(raw);
          } catch (e) {
            // Ignore parse errors
          }
          return null;
        },
      });

      if (results && results[0] && results[0].result) {
        const session = results[0].result;
        if (session.token) {
          // Write recovered session into extension storage
          await setInStorage({
            firebaseToken: session.token,
            userEmail: session.email || '',
            userName: session.displayName || '',
            userPhoto: session.photoURL || '',
            userMode: session.mode || 'private',
            authTimestamp: Date.now(),
          });
          console.log('[Popup] ✅ Recovered auth via scripting.executeScript (Layer 3)');
          return true;
        }
      }
    } catch (e) {
      console.log('[Popup] scripting.executeScript recovery failed:', e.message);
    }
    return false;
  }

  // ============================================================
  // 4. Connect / Sign In button
  // ============================================================
  if (signinActionBtn) {
    signinActionBtn.addEventListener('click', async () => {
      const portalTab = await findPortalTab();
      if (portalTab) {
        // Activate the existing tab and reload it to inject fresh content script
        chrome.tabs.update(portalTab.id, { active: true });
        if (portalTab.windowId) {
          chrome.windows.update(portalTab.windowId, { focused: true });
        }
        // Reload the portal tab to get a fresh content script injected
        chrome.tabs.reload(portalTab.id);
        setSyncStatus('syncing');

        // Wait for tab to finish loading, then retry sync
        chrome.tabs.onUpdated.addListener(function reloadListener(tabId, changeInfo) {
          if (tabId === portalTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(reloadListener);
            setTimeout(() => runAuthSync(), 800);
          }
        });
      } else {
        chrome.tabs.create({ url: PORTAL_URL });
      }
    });
  }

  // ============================================================
  // 5. Open Cloud Dashboard
  // ============================================================
  if (openDashboardBtn) {
    openDashboardBtn.addEventListener('click', async () => {
      const portalTab = await findPortalTab();
      if (portalTab) {
        chrome.tabs.update(portalTab.id, { active: true });
        if (portalTab.windowId) {
          chrome.windows.update(portalTab.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: PORTAL_URL });
      }
    });
  }

  // ============================================================
  // 6. Settings Listeners
  // ============================================================
  if (autoTranslateToggle) {
    autoTranslateToggle.addEventListener('change', () => {
      chrome.storage.sync.set({ autoTranslate: autoTranslateToggle.checked });
    });
  }

  if (targetLangSelect) {
    targetLangSelect.addEventListener('change', () => {
      chrome.storage.sync.set({ targetLang: targetLangSelect.value });
    });
  }

  // ============================================================
  // 7. Sign Out — Clears extension storage + notifies portal
  // ============================================================
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      chrome.storage.local.remove(
        ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode', 'authTimestamp'],
        () => {
          renderAuthState();
        }
      );

      // Also clear localStorage session on portal tab (if open)
      const portalTab = await findPortalTab();
      if (portalTab) {
        try {
          chrome.scripting.executeScript({
            target: { tabId: portalTab.id },
            func: () => {
              localStorage.removeItem('mmt_auth_session');
            },
          });
        } catch (_) { /* Best effort */ }
      }
    });
  }

  // ============================================================
  // 8. Reactive Storage Listener — auto-update UI on changes
  // ============================================================
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.firebaseToken || changes.userMode)) {
      renderAuthState();
    }
  });

  // ============================================================
  // Utility Helpers
  // ============================================================
  function findPortalTab() {
    return new Promise(resolve => {
      if (!chrome.tabs?.query) { resolve(null); return; }
      chrome.tabs.query({ url: PORTAL_PATTERN }, tabs => {
        resolve(tabs && tabs.length > 0 ? tabs[0] : null);
      });
    });
  }

  function getFromStorage(key) {
    return new Promise(resolve => {
      chrome.storage.local.get([key], data => resolve(data[key] || null));
    });
  }

  function setInStorage(obj) {
    return new Promise(resolve => {
      chrome.storage.local.set(obj, resolve);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Boot
  // ============================================================
  renderAuthState();
});
