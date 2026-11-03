// Yomi Image Translator - Popup Logic v2.2.0

document.addEventListener('DOMContentLoaded', () => {
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');
  const geminiModelSelect = document.getElementById('gemini-model');
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
    if (data.byok?.googleModel) {
      geminiModelSelect.value = data.byok.googleModel;
    }
    if (data.byok?.googleApiKey) {
      geminiKeyInput.value = data.byok.googleApiKey;
    }
  });

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const autoTranslate = autoTranslateToggle.checked;
    const targetLang = targetLangSelect.value;
    const googleModel = geminiModelSelect.value;
    const googleApiKey = geminiKeyInput.value.trim();

    chrome.storage.sync.get(['byok'], existing => {
      const byok = existing.byok || {};
      byok.googleApiKey = googleApiKey;
      byok.googleModel = googleModel;

      chrome.storage.sync.set(
        {
          autoTranslate,
          targetLang,
          byok,
        },
        () => {
          saveBtn.innerText = '✓ Saved Successfully!';
          saveBtn.style.background = '#16a34a';
          setTimeout(() => {
            saveBtn.innerText = 'Save Settings';
            saveBtn.style.background = '#f97316';
          }, 1500);
        }
      );
    });
  });
});
