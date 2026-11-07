// Manga & Manhwa Image Translator - Modern Extension Popup v1.1.0
// Features: Zero-Knowledge Cloud Vault, Auto-Detection & Dual Auth Bridge

document.addEventListener('DOMContentLoaded', () => {
  const signedOutView = document.getElementById('signed-out-view');
  const signedInView = document.getElementById('signed-in-view');

  // User elements
  const userNameEl = document.getElementById('user-name');
  const userEmailEl = document.getElementById('user-email');
  const userAvatarContainer = document.getElementById('user-avatar-container');
  const modeBadgeEl = document.getElementById('mode-badge');
  const signinActionBtn = document.getElementById('signin-action-btn');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const syncDetectionStatus = document.getElementById('sync-detection-status');

  // Settings elements
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');

  const PORTAL_URL = 'https://manga-manhwa-translator.vercel.app/';

  // 1. Update UI from stored auth state
  function updateAuthState() {
    chrome.storage.local.get(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode'],
      localData => {
        const token = localData.firebaseToken;

        if (!token) {
          signedOutView.style.display = 'block';
          signedInView.style.display = 'none';
          attemptAutoSyncWithOpenTab();
          return;
        }

        // User is authenticated
        signedOutView.style.display = 'none';
        signedInView.style.display = 'block';

        const email = localData.userEmail || 'user@email.com';
        const name = localData.userName || email.split('@')[0];
        const photo = localData.userPhoto;
        const mode = localData.userMode || 'private';

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

    // Load user translation preferences
    chrome.storage.sync.get(['autoTranslate', 'targetLang'], syncData => {
      if (syncData.autoTranslate !== undefined) {
        autoTranslateToggle.checked = Boolean(syncData.autoTranslate);
      }
      if (syncData.targetLang) {
        targetLangSelect.value = syncData.targetLang;
      }
    });
  }

  // 2. Intelligent Auto-Sync: Check if portal is open in another tab
  function attemptAutoSyncWithOpenTab() {
    if (!chrome.tabs?.query) return;

    chrome.tabs.query({ url: '*://manga-manhwa-translator.vercel.app/*' }, tabs => {
      if (tabs && tabs.length > 0) {
        if (syncDetectionStatus) {
          syncDetectionStatus.innerHTML = `
            <div class="spinner-sm"></div>
            <span>Active portal detected! Syncing session…</span>
          `;
        }

        // Request auth from the open tab's content script
        chrome.tabs.sendMessage(tabs[0].id, { action: 'REQUEST_AUTH_FROM_PAGE' }, () => {
          if (chrome.runtime.lastError) {
            // Content script might be loading
            setTimeout(checkTokenAgain, 800);
          } else {
            setTimeout(checkTokenAgain, 500);
          }
        });
      } else {
        if (syncDetectionStatus) {
          syncDetectionStatus.innerHTML = `
            <span>Portal offline. Click below to sign in.</span>
          `;
        }
      }
    });
  }

  function checkTokenAgain() {
    chrome.storage.local.get(['firebaseToken'], res => {
      if (res.firebaseToken) {
        updateAuthState();
      }
    });
  }

  // 3. Connect / Sign In button action
  if (signinActionBtn) {
    signinActionBtn.addEventListener('click', () => {
      chrome.tabs.query({ url: '*://manga-manhwa-translator.vercel.app/*' }, tabs => {
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) {
            chrome.windows.update(tab.windowId, { focused: true });
          }
          chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_AUTH_FROM_PAGE' });
        } else {
          chrome.tabs.create({ url: PORTAL_URL });
        }
      });
    });
  }

  // 4. Open Cloud Dashboard button
  if (openDashboardBtn) {
    openDashboardBtn.addEventListener('click', () => {
      chrome.tabs.query({ url: '*://manga-manhwa-translator.vercel.app/*' }, tabs => {
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) {
            chrome.windows.update(tab.windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: PORTAL_URL });
        }
      });
    });
  }

  // 5. Settings Listeners
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

  // 6. Sign Out
  if (signoutBtn) {
    signoutBtn.addEventListener('click', () => {
      chrome.storage.local.remove(
        ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode', 'authTimestamp'],
        () => {
          updateAuthState();
        }
      );
    });
  }

  // 7. Reactive Storage Listener
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.firebaseToken || changes.userMode)) {
      updateAuthState();
    }
  });

  // Initial load
  updateAuthState();
});
