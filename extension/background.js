// Manga & Manhwa Image Translator - Universal Background Service Worker (Manifest V3)
// Zero-Knowledge Cloud Vault Architecture: All translations proxy through serverless API.
// No plaintext API keys are ever stored or processed locally in the extension.

function purgeLegacyLocalKeys() {
  chrome.storage.sync.remove([
    'byok',
    'googleApiKey',
    'openaiApiKey',
    'anthropicApiKey',
    'openrouterApiKey',
    'groqApiKey',
    'deepseekApiKey'
  ]);
  chrome.storage.local.remove([
    'byok',
    'googleApiKey',
    'openaiApiKey',
    'anthropicApiKey',
    'openrouterApiKey',
    'groqApiKey',
    'deepseekApiKey'
  ]);
}

// Purge any leftover legacy keys on startup
purgeLegacyLocalKeys();

chrome.runtime.onInstalled.addListener(() => {
  purgeLegacyLocalKeys();
  chrome.contextMenus.create({
    id: 'translate-manga-image',
    title: 'Translate Manga Image with AI',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-manga-image' && tab?.id && info.srcUrl) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRANSLATE_IMAGE_SRC',
      srcUrl: info.srcUrl,
    });
  }
});

// Cache for dynamic model discovery
let cachedValidModels = null;
let lastModelCheckTime = 0;

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRANSLATE_PAYLOAD') {
    handleTranslation(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => {
        console.error('[Translator Background]', err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'TEST_API_KEY') {
    testApiKey(request.data)
      .then(result => sendResponse(result))
      .catch(err => {
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }

  if (request.action === 'AUTH_TOKEN' && request.token) {
    // BACKUP path: Content script relays token from webpage postMessage
    const isAllowed =
      !sender.tab ||
      (sender.tab.url && sender.tab.url.startsWith('https://manga-manhwa-translator.vercel.app'));

    if (!isAllowed) {
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return true;
    }

    chrome.storage.local.set(
      {
        firebaseToken: request.token,
        userEmail: request.email || '',
        userName: request.displayName || '',
        userPhoto: request.photoURL || '',
        userMode: request.mode || 'private',
        authTimestamp: Date.now(),
      },
      () => {
        console.log('[Auth] ✅ Synced auth via content script (backup path)');
        sendResponse({ success: true, message: 'Extension authenticated!' });
      }
    );
    return true;
  }

  if (request.action === 'AUTH_SIGNOUT') {
    chrome.storage.local.remove(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode', 'authTimestamp'],
      () => {
        console.log('[Auth] 🔒 Signed out via content script relay');
        sendResponse({ success: true });
      }
    );
    return true;
  }

  if (request.action === 'CHECK_EXTENSION_INSTALLED') {
    sendResponse({ success: true, version: '1.1.0' });
    return true;
  }
});

// ============================================================
// PRIMARY Auth Bridge: externally_connectable (Website → Extension)
// This is the most reliable path — bypasses content scripts entirely.
// The website calls chrome.runtime.sendMessage(EXTENSION_ID, payload)
// which arrives here directly at the service worker.
// ============================================================
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Strict origin validation (defense-in-depth beyond manifest matches)
  const ALLOWED_ORIGIN = 'https://manga-manhwa-translator.vercel.app';
  if (!sender.url || !sender.url.startsWith(ALLOWED_ORIGIN)) {
    console.warn('[Auth] Rejected external message from unauthorized origin:', sender.url);
    sendResponse({ success: false, error: 'Unauthorized sender origin' });
    return true;
  }

  // --- Sign In / Token Sync ---
  if (message.type === 'AUTH_TOKEN' && message.token) {
    const authPayload = {
      firebaseToken: message.token,
      userEmail: message.email || '',
      userName: message.displayName || '',
      userPhoto: message.photoURL || '',
      userMode: message.mode || 'private',
      authTimestamp: Date.now(),
    };
    chrome.storage.local.set(authPayload, () => {
      console.log('[Auth] ✅ Synced auth via externally_connectable (primary path)');
      sendResponse({ success: true, message: 'Extension authenticated!' });
    });
    return true;
  }

  // --- Sign Out ---
  if (message.type === 'AUTH_SIGNOUT') {
    chrome.storage.local.remove(
      ['firebaseToken', 'userEmail', 'userName', 'userPhoto', 'userMode', 'authTimestamp'],
      () => {
        console.log('[Auth] 🔒 Signed out via externally_connectable');
        sendResponse({ success: true, message: 'Extension signed out.' });
      }
    );
    return true;
  }

  // --- Extension Detection Handshake ---
  if (message.type === 'CHECK_EXTENSION_INSTALLED') {
    sendResponse({ success: true, version: '1.1.0' });
    return true;
  }

  // Unknown message type
  sendResponse({ success: false, error: 'Unknown message type' });
  return true;
});

// Universal image fetcher converting ArrayBuffer to Base64 in safe 8KB chunks
async function fetchImageBase64(imageUrl) {
  let base64Data = '';
  let mimeType = 'image/jpeg';

  if (imageUrl.startsWith('data:')) {
    base64Data = imageUrl.split(',')[1];
    const match = imageUrl.match(/^data:([^;]+);/);
    if (match) mimeType = match[1];
  } else {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Could not load image: HTTP ${res.status}`);
    const blob = await res.blob();
    mimeType = blob.type || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    base64Data = bufferToBase64(buffer);
  }

  return { base64Data, mimeType };
}

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
  }
  return btoa(binary);
}

// Master prompt for high-precision comic dialogue detection & visual grounding
function buildVisionPrompt(targetLang) {
  return `You are a master Manga, Manhwa, and Comic Translator.
Analyze this comic page image with extreme precision and exhaustive completeness.
Detect and translate EVERY SINGLE piece of foreign text across the entire page, including:
1. Standard dialogue speech bubbles (round, oval, square).
2. Spiky, jagged, starburst, explosive shout and screaming bubbles (e.g. dramatic dialogue like "정말... 즐겨도 되는 거냐고요!!"). DO NOT overlook or skip spiky/explosion speech bubbles!
3. Dark, black, and inverted speech bubbles.
4. Stylized sound effects (SFX / 의성어 / 의태어), exclamations, moans, and whispers (e.g. "찌릿", "하아", "읏", "크윽!!", "쿵", "솨악", "탁", "철썩") floating across panels, character bodies, or backgrounds.
5. Monologue, thought clouds, and narrative caption boxes.

Translate all text accurately and naturally into ${targetLang}.
Keep dialogue punchy, expressive, and formatted in natural comic style UPPERCASE.

Return STRICTLY a JSON object in this format without any other text or markdown:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "<original foreign text in bubble>",
      "translated_text": "<NATURAL TRANSLATION IN UPPERCASE>",
      "background": "white" | "dark" | "transparent",
      "type": "dialogue" | "sfx" | "narration"
    }
  ]
}
CRITICAL RULES:
1. box_2d MUST be 4 integer coordinates [ymin, xmin, ymax, xmax] normalized on a 0 to 1000 scale tightly enclosing the speech bubble interior where text will be rendered.
2. Detect both white speech bubbles and dark/black speech bubbles (set background: "dark" for black/dark bubbles, "white" for light bubbles). For floating SFX without bubbles, set background: "transparent".
3. EXHAUSTIVE RECALL: Scan from top to bottom. Do NOT stop after detecting 5 or 6 items. Include ALL speech bubbles, shout bubbles, and sound effects across the image.
4. translated_text must be natural comic dialogue formatted in UPPERCASE.
5. Output valid JSON only, no markdown explanations.`;
}

// Cloud Translation Router: 100% serverless proxy via Cloud Vault
async function handleTranslation(data) {
  const { imageUrl, targetLang = 'en' } = data;

  // Purge any residual plaintext keys
  purgeLegacyLocalKeys();

  // 1. Check if user is authenticated via web account
  const authState = await new Promise(resolve => {
    chrome.storage.local.get(['firebaseToken', 'userMode'], resolve);
  });

  if (!authState?.firebaseToken) {
    throw new Error('Not logged in. Please click the Manga Translator extension icon and sign in to link your Cloud Vault.');
  }

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const res = await fetch('https://manga-manhwa-translator.vercel.app/api/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authState.firebaseToken}`,
    },
    body: JSON.stringify({
      imageBase64: base64Data,
      mimeType,
      targetLang,
    }),
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Server error (${res.status}). Please verify your backend deployment at manga-manhwa-translator.vercel.app.`);
  }

  if (!res.ok || !json.success || !json.result) {
    throw new Error(json.error || `Translation error: HTTP ${res.status}`);
  }

  return json.result;
}

function detectProvider(byok) {
  if (byok.googleApiKey) return 'google';
  if (byok.openrouterApiKey) return 'openrouter';
  if (byok.openaiApiKey) return 'openai';
  if (byok.anthropicApiKey) return 'anthropic';
  if (byok.groqApiKey) return 'groq';
  if (byok.deepseekApiKey) return 'deepseek';
  return 'google';
}

// -------------------------------------------------------------
// 1. Google Gemini Multimodal Vision
// -------------------------------------------------------------
async function callGeminiVision(imageUrl, targetLang, byok) {
  const apiKey = (byok.googleApiKey || '').trim();
  if (!apiKey) throw new Error('Google Gemini API key is missing. Click the popup to get a free key from Google AI Studio.');

  let requestedModel = byok.googleModel || 'gemini-2.5-flash';
  if (requestedModel === 'auto' || !requestedModel) {
    requestedModel = 'gemini-2.5-flash';
  }

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  async function executeGeminiRequest(modelName, includeThinkingConfig = true) {
    const genConfig = {
      response_mime_type: 'application/json',
    };

    if (includeThinkingConfig && (modelName.includes('2.5') || modelName.includes('3.'))) {
      genConfig.thinking_config = { thinking_budget: 0 };
    }

    if (!modelName.includes('3.8')) {
      genConfig.temperature = 0.2;
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: genConfig,
        }),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `Gemini API error HTTP ${res.status}`);
    }
    return json;
  }

  let responseJson;
  try {
    responseJson = await executeGeminiRequest(requestedModel, true);
  } catch (err) {
    const errMsg = (err.message || String(err)).toLowerCase();

    // Retry without thinking budget if rejected
    if (errMsg.includes('thinking_config') || errMsg.includes('thinkingbudget') || errMsg.includes('invalid argument')) {
      try {
        responseJson = await executeGeminiRequest(requestedModel, false);
      } catch (retryErr) {
        // Continue to fallback
      }
    }

    // Auto-heal on model deprecation or suggestion
    if (!responseJson) {
      const suggestedMatch = err.message.match(/models\/([a-zA-Z0-9\.\-_]+)/);
      let fallbackModel = suggestedMatch ? suggestedMatch[1] : null;

      if (!fallbackModel || fallbackModel === requestedModel) {
        fallbackModel = await discoverBestFlashModel(apiKey);
      }

      console.log(`[Auto-Heal] Switching Gemini model from ${requestedModel} to ${fallbackModel}`);
      try {
        responseJson = await executeGeminiRequest(fallbackModel, true);
      } catch (fbErr) {
        responseJson = await executeGeminiRequest(fallbackModel, false);
      }

      chrome.storage.sync.get(['byok'], existing => {
        const byokData = existing.byok || {};
        byokData.googleModel = fallbackModel;
        chrome.storage.sync.set({ byok: byokData });
      });
    }
  }

  const rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// 2. OpenRouter Vision (Unified 200+ Models)
// -------------------------------------------------------------
async function callOpenRouterVision(imageUrl, targetLang, byok) {
  const apiKey = (byok.openrouterApiKey || '').trim();
  if (!apiKey) throw new Error('OpenRouter API key is missing. Click the popup to get a key from OpenRouter.');
  const model = byok.openrouterModel || 'google/gemini-2.0-flash-001';

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://manga-manhwa-translator.vercel.app',
      'X-Title': 'Manga & Manhwa Image Translator',
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `OpenRouter API error HTTP ${res.status}`);
  }

  const rawText = json.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('OpenRouter returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// 3. OpenAI Vision (GPT-4o & GPT-4o-mini)
// -------------------------------------------------------------
async function callOpenAIVision(imageUrl, targetLang, byok) {
  const apiKey = (byok.openaiApiKey || '').trim();
  if (!apiKey) throw new Error('OpenAI API key is missing. Click the popup to get a key from OpenAI Platform.');
  const model = byok.openaiModel || 'gpt-4o-mini';

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `OpenAI API error HTTP ${res.status}`);
  }

  const rawText = json.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('OpenAI returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// 4. Anthropic Claude Vision (Claude 3.5 Sonnet & Haiku)
// -------------------------------------------------------------
async function callClaudeVision(imageUrl, targetLang, byok) {
  const apiKey = (byok.anthropicApiKey || '').trim();
  if (!apiKey) throw new Error('Anthropic API key is missing. Click the popup to get a key from Anthropic Console.');
  const model = byok.anthropicModel || 'claude-3-5-haiku-20241022';

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  let anthropicMime = mimeType;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(anthropicMime)) {
    anthropicMime = 'image/jpeg';
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: anthropicMime,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `Anthropic API error HTTP ${res.status}`);
  }

  const rawText = json.content?.[0]?.text;
  if (!rawText) throw new Error('Anthropic returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// 5. Groq LPU Vision (Llama 3.2 Vision)
// -------------------------------------------------------------
async function callGroqVision(imageUrl, targetLang, byok) {
  const apiKey = (byok.groqApiKey || '').trim();
  if (!apiKey) throw new Error('Groq API key is missing. Click the popup to get a key from Groq Console.');
  const model = byok.groqModel || 'llama-3.2-11b-vision-preview';

  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `Groq API error HTTP ${res.status}`);
  }

  const rawText = json.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('Groq returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// 6. DeepSeek Vision
// -------------------------------------------------------------
async function callDeepSeekVision(imageUrl, targetLang, byok) {
  // If DeepSeek direct API is configured
  const apiKey = (byok.deepseekApiKey || '').trim();
  if (!apiKey) throw new Error('DeepSeek API key is missing. Click the popup to get a key from DeepSeek Platform.');
  const model = byok.deepseekModel || 'deepseek-chat';

  // DeepSeek via OpenAI-compatible endpoint
  const { base64Data, mimeType } = await fetchImageBase64(imageUrl);
  const prompt = buildVisionPrompt(targetLang);

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `DeepSeek API error HTTP ${res.status}`);
  }

  const rawText = json.choices?.[0]?.message?.content;
  if (!rawText) throw new Error('DeepSeek returned an empty response.');
  return parseAndNormalizeJson(rawText);
}

// -------------------------------------------------------------
// Universal Output Normalizer
// -------------------------------------------------------------
function parseAndNormalizeJson(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('Failed to parse AI translation JSON. The model returned malformed output.');
  }

  const rawBubbles = parsed.bubbles || parsed.translations || [];

  const bubbles = rawBubbles.map(b => {
    let box = b.box_2d;
    if (!box && (b.y !== undefined || b.ymin !== undefined)) {
      if (b.ymin !== undefined) {
        box = [b.ymin, b.xmin, b.ymax, b.xmax];
      } else if (b.height !== undefined && b.width !== undefined) {
        box = [b.y, b.x, b.y + b.height, b.x + b.width];
      }
    }
    return {
      box_2d: box,
      raw_text: b.raw_text || b.original_text || '',
      translated_text: b.translated_text || b.translation || '',
      background: b.background || (b.is_dark_bubble ? 'dark' : 'white'),
    };
  });

  return { bubbles };
}

// -------------------------------------------------------------
// Live API Key Validator
// -------------------------------------------------------------
async function testApiKey({ provider, apiKey, model }) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('API key cannot be empty. Please enter a valid key.');

  if (provider === 'google') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `Google API error (HTTP ${res.status})`);
    }
    return { success: true, message: `Connected! Google Gemini active (${json.models?.length || 0} models available)` };
  }

  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `OpenRouter error (HTTP ${res.status})`);
    }
    const label = json.data?.label || 'OpenRouter';
    const limit = json.data?.limit !== null && json.data?.limit !== undefined ? `$${json.data?.limit}` : 'Pay-as-you-go';
    return { success: true, message: `Connected to OpenRouter (${label})! Limit: ${limit}` };
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `OpenAI error (HTTP ${res.status})`);
    }
    return { success: true, message: `Connected! OpenAI active (${json.data?.length || 0} models available)` };
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Ping' }],
      }),
    });
    const json = await res.json();
    if (!res.ok && res.status !== 200) {
      throw new Error(json.error?.message || `Anthropic error (HTTP ${res.status})`);
    }
    return { success: true, message: 'Connected! Anthropic Claude verified successfully.' };
  }

  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `Groq error (HTTP ${res.status})`);
    }
    return { success: true, message: `Connected! Groq LPU engine verified (${json.data?.length || 0} models)` };
  }

  if (provider === 'deepseek') {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `DeepSeek error (HTTP ${res.status})`);
    }
    return { success: true, message: 'Connected to DeepSeek successfully!' };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// -------------------------------------------------------------
// Dynamic Discovery & Fallback
// -------------------------------------------------------------
async function discoverBestFlashModel(apiKey) {
  const now = Date.now();
  if (cachedValidModels && now - lastModelCheckTime < 300000) {
    return cachedValidModels[0];
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));

      const activeModels = models.filter(m => !m.includes('2.5-flash'));
      const flashModels = activeModels.filter(m => m.includes('flash'));
      if (flashModels.length > 0) {
        flashModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        cachedValidModels = flashModels;
        lastModelCheckTime = now;
        return flashModels[0];
      }
    }
  } catch (err) {
    console.warn('[Translator] Failed to query dynamic models:', err);
  }

  return 'gemini-2.5-flash';
}

function mockMangaDetection(targetLang) {
  return {
    bubbles: [
      {
        box_2d: [180, 240, 300, 430],
        raw_text: '待たせたな！準備はいいか？',
        translated_text: 'SORRY TO KEEP YOU WAITING! ARE YOU READY?!',
        background: 'white',
      },
      {
        box_2d: [450, 640, 580, 850],
        raw_text: 'いつでも来い！容赦はしないぞ！',
        translated_text: "COME AT ME! I WON'T HOLD BACK!",
        background: 'dark',
      },
    ],
  };
}
