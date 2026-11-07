// Yomi Image Translator - Background Service Worker (Manifest V3)
// Clean-room, high-speed multimodal vision pipeline with self-healing Gemini 3.8 Flash engine.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'yomi-translate-image',
    title: 'Translate Image with Yomi (Gemini 3.8 Flash)',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'yomi-translate-image' && tab?.id && info.srcUrl) {
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
        console.error('[Yomi Background]', err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true; // Keep channel open for async response
  }
});

async function handleTranslation(data) {
  const { imageUrl, targetLang = 'en', byok = {} } = data;

  if (byok.googleApiKey) {
    return await callGeminiVision(imageUrl, targetLang, byok);
  }

  if (byok.openaiApiKey) {
    return await callOpenAIVision(imageUrl, targetLang, byok);
  }

  return mockMangaDetection(targetLang);
}

// Convert ArrayBuffer to Base64 in safe 8KB chunks to prevent stack overflow
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

async function callGeminiVision(imageUrl, targetLang, byok) {
  const apiKey = byok.googleApiKey.trim();
  let requestedModel = byok.googleModel || 'gemini-3.8-flash';

  // Auto-upgrade legacy deprecated 2.5 default to latest Gemini 3.8 Flash
  if (requestedModel === 'gemini-2.5-flash' || requestedModel === 'auto' || !requestedModel) {
    requestedModel = 'gemini-3.8-flash';
  }

  // Extract base64
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

  const prompt = `You are Yomi Image Translator.
Analyze this comic/manga/webtoon page. Locate every speech bubble and text dialogue.
Translate all dialogue accurately into ${targetLang}.
Return JSON only:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "<original foreign text in bubble>",
      "translated_text": "<natural translation in UPPERCASE>",
      "background": "white" | "black" | "dark" | "transparent"
    }
  ]
}
CRITICAL RULES FOR BOX_2D:
- Use [ymin, xmin, ymax, xmax] normalized on a 0 to 1000 integer grid directly framing the speech bubble interior.
- Detect both normal white bubbles and dramatic dark/black speech bubbles.
- Ensure the bounding box tightly encompasses the original text so the translated text covers it perfectly.`;

  async function executeGeminiRequest(modelName, includeThinkingConfig = true) {
    const genConfig = {
      response_mime_type: 'application/json',
    };

    // Google Gemini 3.x and 2.5 Flash models support thinking_budget: 0 to disable thinking delays
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
      throw new Error(json.error?.message || `Gemini API error ${res.status}`);
    }
    return json;
  }

  let responseJson;
  try {
    responseJson = await executeGeminiRequest(requestedModel, true);
  } catch (err) {
    const errMsg = (err.message || String(err)).toLowerCase();
    console.warn(`[Yomi] Attempt with ${requestedModel} failed: ${err.message}`);

    // Case 1: thinking_config rejected (e.g. 400 Bad Request)
    if (errMsg.includes('thinking_config') || errMsg.includes('thinkingbudget') || errMsg.includes('invalid argument')) {
      try {
        responseJson = await executeGeminiRequest(requestedModel, false);
      } catch (retryErr) {
        // Will continue to fallback logic below
      }
    }

    // Case 2: Model unavailable, deprecated, or Google suggested another model
    if (!responseJson) {
      // Check if error message explicitly suggested a model (e.g. "update your code to use models/gemini-3.8-flash")
      const suggestedMatch = err.message.match(/models\/([a-zA-Z0-9\.\-_]+)/);
      let fallbackModel = suggestedMatch ? suggestedMatch[1] : null;

      if (!fallbackModel || fallbackModel === requestedModel) {
        fallbackModel = await discoverBestFlashModel(apiKey);
      }

      console.log(`[Yomi Auto-Heal] Switching model from ${requestedModel} to ${fallbackModel}`);
      try {
        responseJson = await executeGeminiRequest(fallbackModel, true);
      } catch (fbErr) {
        // Retry fallback without thinking config if needed
        responseJson = await executeGeminiRequest(fallbackModel, false);
      }

      // Automatically persist working model to chrome.storage
      chrome.storage.sync.get(['byok'], existing => {
        const byokData = existing.byok || {};
        byokData.googleModel = fallbackModel;
        chrome.storage.sync.set({ byok: byokData });
      });
    }
  }

  const rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned an empty response.');

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  return JSON.parse(cleaned);
}

// Dynamically discover supported Flash models from Gemini ModelService
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

      // Filter out deprecated models
      const activeModels = models.filter(m => !m.includes('2.5-flash'));

      // Prefer 3.8-flash, 3.5-flash, 3.1-flash, 2.0-flash
      const flashModels = activeModels.filter(m => m.includes('flash'));
      if (flashModels.length > 0) {
        flashModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        cachedValidModels = flashModels;
        lastModelCheckTime = now;
        return flashModels[0];
      }
      if (activeModels.length > 0) {
        activeModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
        cachedValidModels = activeModels;
        lastModelCheckTime = now;
        return activeModels[0];
      }
    }
  } catch (err) {
    console.warn('[Yomi] Failed to query dynamic model list:', err);
  }

  return 'gemini-3.8-flash';
}

async function callOpenAIVision(imageUrl, targetLang, byok) {
  const apiKey = byok.openaiApiKey.trim();
  const model = byok.openaiModel || 'gpt-4o-mini';

  const prompt = `Detect speech bubbles in this manga and translate to: ${targetLang}.
Return JSON:
{
  "bubbles": [
    {
      "x": number, "y": number, "width": number, "height": number,
      "raw_text": "original", "translated_text": "translation"
    }
  ]
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Translate image bubbles' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty OpenAI response');
  return JSON.parse(text);
}

function mockMangaDetection(targetLang) {
  return {
    bubbles: [
      {
        x: 240,
        y: 180,
        width: 190,
        height: 120,
        raw_text: '待たせたな！準備はいいか？',
        translated_text: 'SORRY TO KEEP YOU WAITING! ARE YOU READY?!',
      },
      {
        x: 640,
        y: 450,
        width: 210,
        height: 130,
        raw_text: 'いつでも来い！容赦はしないぞ！',
        translated_text: "COME AT ME! I WON'T HOLD BACK!",
      },
    ],
  };
}
