// Manga & Manhwa Image Translator - Universal Popup Logic v1.0.0
// Multi-LLM BYOK controller with direct provider links, real-time key testing, and dynamic models.

const PROVIDERS = {
  google: {
    name: 'Google Gemini',
    badge: 'Google Gemini',
    keyLabel: 'Google Gemini API Key',
    keyPlaceholder: 'AIzaSy... (100% Free & Private)',
    storageKey: 'googleApiKey',
    modelStorageKey: 'googleModel',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    getKeyText: 'Get Free Key ↗',
    portalName: 'Google AI Studio',
    hint: '✨ 100% Free API key with 15 requests/min. No credit card required at Google AI Studio.',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Latest & Recommended)' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite (Ultra Fast)' },
      { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash (Next-Gen Multimodal)' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Balanced)' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Stable)' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    badge: 'OpenRouter',
    keyLabel: 'OpenRouter API Key',
    keyPlaceholder: 'sk-or-v1-... (Unified 200+ Models)',
    storageKey: 'openrouterApiKey',
    modelStorageKey: 'openrouterModel',
    getKeyUrl: 'https://openrouter.ai/keys',
    getKeyText: 'Get API Key ↗',
    portalName: 'OpenRouter Keys',
    hint: '✨ One universal key gives you access to 200+ models (Claude, GPT-4o, DeepSeek, Gemini) with zero limits.',
    defaultModel: 'google/gemini-2.0-flash-001',
    models: [
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Ultra Cheap & Fast)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (High Accuracy)' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku (Top OCR & Dialogue)' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Ultra-Low Cost)' },
      { id: 'meta-llama/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision (Open Source)' },
      { id: 'openai/gpt-4o', name: 'GPT-4o (Flagship Vision)' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Elite SFX & Nuance)' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
  openai: {
    name: 'OpenAI',
    badge: 'OpenAI',
    keyLabel: 'OpenAI API Key',
    keyPlaceholder: 'sk-proj-...',
    storageKey: 'openaiApiKey',
    modelStorageKey: 'openaiModel',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    getKeyText: 'Get API Key ↗',
    portalName: 'OpenAI Platform',
    hint: '✨ Official OpenAI platform key for GPT-4o & GPT-4o-mini vision models.',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Recommended • Budget)' },
      { id: 'gpt-4o', name: 'GPT-4o (High-Res Multimodal)' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude',
    badge: 'Anthropic Claude',
    keyLabel: 'Anthropic API Key',
    keyPlaceholder: 'sk-ant-...',
    storageKey: 'anthropicApiKey',
    modelStorageKey: 'anthropicModel',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    getKeyText: 'Get API Key ↗',
    portalName: 'Anthropic Console',
    hint: '✨ Anthropic Console API key for Claude 3.5 Sonnet & Claude 3.5 Haiku.',
    defaultModel: 'claude-3-5-haiku-20241022',
    models: [
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Ultra Fast & Crisp)' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Premier Nuance & SFX)' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
  groq: {
    name: 'Groq',
    badge: 'Groq LPU',
    keyLabel: 'Groq API Key',
    keyPlaceholder: 'gsk_...',
    storageKey: 'groqApiKey',
    modelStorageKey: 'groqModel',
    getKeyUrl: 'https://console.groq.com/keys',
    getKeyText: 'Get API Key ↗',
    portalName: 'Groq Console',
    hint: '✨ Groq Cloud API key for ultra-fast 500+ tokens/sec LPU inference.',
    defaultModel: 'llama-3.2-11b-vision-preview',
    models: [
      { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision (500+ tok/s)' },
      { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision (High Precision)' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    badge: 'DeepSeek',
    keyLabel: 'DeepSeek API Key',
    keyPlaceholder: 'sk-...',
    storageKey: 'deepseekApiKey',
    modelStorageKey: 'deepseekModel',
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    getKeyText: 'Get API Key ↗',
    portalName: 'DeepSeek Platform',
    hint: '✨ DeepSeek Open Platform API key. (Tip: For vision, OpenRouter is also supported).',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 Standard' },
      { id: 'custom', name: 'Enter Custom Model...' },
    ],
  },
};

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const targetLangSelect = document.getElementById('target-lang');
  const aiProviderSelect = document.getElementById('ai-provider');
  const activeProviderBadge = document.getElementById('active-provider-badge');

  // Callout elements
  const calloutProviderName = document.getElementById('callout-provider-name');
  const getKeyLink = document.getElementById('get-key-link');
  const getKeyLinkText = document.getElementById('get-key-link-text');
  const calloutHintText = document.getElementById('callout-hint-text');

  // Key elements
  const keyInputLabel = document.getElementById('key-input-label');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const testKeyBtn = document.getElementById('test-key-btn');
  const testStatus = document.getElementById('test-status');

  // Model elements
  const modelSelect = document.getElementById('model-select');
  const customModelContainer = document.getElementById('custom-model-container');
  const customModelInput = document.getElementById('custom-model-input');

  // Save button
  const saveBtn = document.getElementById('save-btn');

  // State cache
  let cachedByok = {};
  let currentProvider = 'google';

  // Toggle Password Visibility
  let isKeyVisible = false;
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    isKeyVisible = !isKeyVisible;
    apiKeyInput.type = isKeyVisible ? 'text' : 'password';
    toggleKeyVisibilityBtn.style.color = isKeyVisible ? '#f97316' : '#71717a';
  });

  // Render provider details into UI
  function updateProviderUI(providerKey, preserveInput = false) {
    currentProvider = providerKey;
    const config = PROVIDERS[providerKey] || PROVIDERS.google;

    // Header badge
    activeProviderBadge.textContent = config.badge;

    // Callout box
    calloutProviderName.textContent = config.portalName;
    getKeyLink.href = config.getKeyUrl;
    getKeyLinkText.textContent = config.getKeyText;
    calloutHintText.textContent = config.hint;

    // Key input
    keyInputLabel.textContent = config.keyLabel;
    apiKeyInput.placeholder = config.keyPlaceholder;

    if (!preserveInput) {
      const savedKey = cachedByok[config.storageKey] || '';
      apiKeyInput.value = savedKey;
    }

    // Populate models
    modelSelect.innerHTML = '';
    const savedModel = cachedByok[config.modelStorageKey] || config.defaultModel;
    let modelMatched = false;

    config.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (m.id === savedModel) {
        opt.selected = true;
        modelMatched = true;
      }
      modelSelect.appendChild(opt);
    });

    if (!modelMatched && savedModel && savedModel !== 'custom') {
      const customOpt = document.createElement('option');
      customOpt.value = savedModel;
      customOpt.textContent = `${savedModel} (Custom Saved)`;
      customOpt.selected = true;
      modelSelect.insertBefore(customOpt, modelSelect.firstChild);
      modelMatched = true;
    }

    if (modelSelect.value === 'custom') {
      customModelContainer.style.display = 'block';
    } else {
      customModelContainer.style.display = 'none';
    }

    // Reset test status
    testStatus.textContent = '';
    testStatus.className = 'test-status';
  }

  // Model change handler
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customModelContainer.style.display = 'block';
      customModelInput.focus();
    } else {
      customModelContainer.style.display = 'none';
    }
  });

  // Provider change handler
  aiProviderSelect.addEventListener('change', () => {
    // Preserve current entered key into cache before switching
    const prevConfig = PROVIDERS[currentProvider];
    if (prevConfig) {
      cachedByok[prevConfig.storageKey] = apiKeyInput.value.trim();
    }
    updateProviderUI(aiProviderSelect.value);
  });

  // Load Settings from Chrome Storage
  chrome.storage.sync.get(['autoTranslate', 'targetLang', 'byok'], data => {
    if (data.autoTranslate !== undefined) {
      autoTranslateToggle.checked = Boolean(data.autoTranslate);
    }
    if (data.targetLang) {
      targetLangSelect.value = data.targetLang;
    }

    cachedByok = data.byok || {};

    // Auto-heal legacy deprecated gemini-2.5-flash
    if (cachedByok.googleModel === 'gemini-2.5-flash') {
      cachedByok.googleModel = 'gemini-3.8-flash';
      chrome.storage.sync.set({ byok: cachedByok });
    }

    const activeProvider = cachedByok.activeProvider || (cachedByok.googleApiKey ? 'google' : 'google');
    aiProviderSelect.value = activeProvider;
    updateProviderUI(activeProvider);
  });

  // Test API Key Live
  testKeyBtn.addEventListener('click', () => {
    const provider = currentProvider;
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value === 'custom' ? customModelInput.value.trim() : modelSelect.value;

    if (!apiKey) {
      testStatus.textContent = 'Please enter an API key first.';
      testStatus.className = 'test-status error';
      return;
    }

    testKeyBtn.disabled = true;
    testStatus.textContent = 'Verifying key...';
    testStatus.className = 'test-status loading';

    chrome.runtime.sendMessage(
      {
        action: 'TEST_API_KEY',
        data: { provider, apiKey, model },
      },
      res => {
        testKeyBtn.disabled = false;
        if (chrome.runtime.lastError) {
          testStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
          testStatus.className = 'test-status error';
          return;
        }

        if (res?.success) {
          testStatus.textContent = `✓ ${res.message}`;
          testStatus.className = 'test-status success';
        } else {
          testStatus.textContent = `✗ ${res?.error || 'Validation failed'}`;
          testStatus.className = 'test-status error';
        }
      }
    );
  });

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const autoTranslate = autoTranslateToggle.checked;
    const targetLang = targetLangSelect.value;
    const activeProvider = aiProviderSelect.value;
    const currentKey = apiKeyInput.value.trim();
    const config = PROVIDERS[activeProvider] || PROVIDERS.google;

    // Update active provider values in cache
    cachedByok.activeProvider = activeProvider;
    cachedByok[config.storageKey] = currentKey;

    let chosenModel = modelSelect.value;
    if (chosenModel === 'custom') {
      chosenModel = customModelInput.value.trim() || config.defaultModel;
    }
    cachedByok[config.modelStorageKey] = chosenModel;

    chrome.storage.sync.set(
      {
        autoTranslate,
        targetLang,
        byok: cachedByok,
      },
      () => {
        saveBtn.innerText = '✓ Settings Saved!';
        saveBtn.style.background = '#16a34a';
        setTimeout(() => {
          saveBtn.innerText = 'Save Settings';
          saveBtn.style.background = 'linear-gradient(135deg, #f97316, #ea580c)';
        }, 1500);
      }
    );
  });
});
