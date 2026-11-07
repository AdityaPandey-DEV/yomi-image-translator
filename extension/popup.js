// Manga & Manhwa Image Translator - Extension Popup Logic v1.1.0
// Authentication & Cloud Vault Synchronizer

document.addEventListener('DOMContentLoaded', () => {
  const signedOutView = document.getElementById('signed-out-view');
  const signedInView = document.getElementById('signed-in-view');

  // User elements
  const userNameEl = document.getElementById('user-name');
  const userEmailEl = document.getElementById('user-email');
  const userInitialsEl = document.getElementById('user-initials');
  const userAvatarContainer = document.getElementById('user-avatar-container');
  const modeBadgeEl = document.getElementById('mode-badge');
  const signoutBtn = document.getElementById('signout-btn');

  // Settings elements
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');

  function updateAuthState() {
    chrome.storage.local.get(['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode'], localData => {
      const token = localData.firebaseToken;

      if (!token) {
        signedOutView.style.display = 'block';
        signedInView.style.display = 'none';
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
        const initial = (name[0] || 'U').toUpperCase();
        userAvatarContainer.innerHTML = `<span id="user-initials">${initial}</span>`;
      }

      if (mode === 'shared') {
        modeBadgeEl.textContent = 'Shared Pool';
        modeBadgeEl.className = 'mode-badge mode-shared';
      } else {
        modeBadgeEl.textContent = 'Private Vault';
        modeBadgeEl.className = 'mode-badge mode-private';
      }
    });

    // Load settings from sync storage
    chrome.storage.sync.get(['autoTranslate', 'targetLang'], syncData => {
      if (syncData.autoTranslate !== undefined) {
        autoTranslateToggle.checked = Boolean(syncData.autoTranslate);
      }
      if (syncData.targetLang) {
        targetLangSelect.value = syncData.targetLang;
      }
    });
  }

  // Initial state check
  updateAuthState();

  // Listen for external sync updates from the website
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' || areaName === 'sync') {
      updateAuthState();
    }
  });

  // Save settings on changes
  autoTranslateToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoTranslate: autoTranslateToggle.checked });
  });

  targetLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ targetLang: targetLangSelect.value });
  });

  // Sign out
  signoutBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode'], () => {
      updateAuthState();
    });
  });
});
