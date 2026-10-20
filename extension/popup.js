// Torii Extension Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');
  const geminiKeyInput = document.getElementById('gemini-key');
  const saveBtn = document.getElementById('save-btn');

  // Load existing settings
  chrome.storage.sync.get(['autoTranslate', 'targetLang', 'byok'], data => {
    if (data.autoTranslate !== undefined) {
      autoTranslateToggle.checked = Boolean(data.autoTranslate);
    }
    if (data.targetLang) {
      targetLangSelect.value = data.targetLang;
    }
    if (data.byok?.googleApiKey) {
      geminiKeyInput.value = data.byok.googleApiKey;
    }
  });

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const autoTranslate = autoTranslateToggle.checked;
    const targetLang = targetLangSelect.value;
    const googleApiKey = geminiKeyInput.value.trim();

    chrome.storage.sync.get(['byok'], existing => {
      const byok = existing.byok || {};
      byok.googleApiKey = googleApiKey;

      chrome.storage.sync.set(
        {
          autoTranslate,
          targetLang,
          byok,
        },
        () => {
          saveBtn.innerText = 'Saved!';
          setTimeout(() => {
            saveBtn.innerText = 'Save Settings';
          }, 1200);
        }
      );
    });
  });
});
