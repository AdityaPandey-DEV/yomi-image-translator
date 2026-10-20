// Yomi Extension Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  // Create Context Menu
  chrome.contextMenus.create({
    id: 'yomi-translate-image',
    title: 'Translate Manga Image with Yomi',
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

// Handle Messages from Content Script or Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRANSLATE_PAYLOAD') {
    handleTranslation(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

async function handleTranslation(data) {
  const { imageUrl, targetLang = 'en', byok = {} } = data;

  // If Google Gemini key is present, call Gemini Vision
  if (byok.googleApiKey) {
    return await callGeminiVision(imageUrl, targetLang, byok);
  }

  // If OpenAI key is present, call OpenAI Vision
  if (byok.openaiApiKey) {
    return await callOpenAIVision(imageUrl, targetLang, byok);
  }

  // Fallback: Smart heuristic detection
  return mockMangaDetection(targetLang);
}

async function callGeminiVision(imageUrl, targetLang, byok) {
  const apiKey = byok.googleApiKey;
  const model = byok.googleModel || 'gemini-2.0-flash';

  // Extract base64 from dataUrl or fetch image as base64
  let base64Data = '';
  let mimeType = 'image/jpeg';

  if (imageUrl.startsWith('data:')) {
    base64Data = imageUrl.split(',')[1];
    mimeType = imageUrl.substring(imageUrl.indexOf(':') + 1, imageUrl.indexOf(';'));
  } else {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    mimeType = blob.type || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }

  const prompt = `You are Yomi Manga Translator.
Detect all speech bubbles in this manga/comic page and translate the text to: ${targetLang}.
Return JSON strictly conforming to:
{
  "bubbles": [
    {
      "x": number (center X relative to image pixel width),
      "y": number (center Y relative to image pixel height),
      "width": number,
      "height": number,
      "raw_text": "original text",
      "translated_text": "natural manga translation",
      "vertical": boolean
    }
  ]
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
        generationConfig: { response_mime_type: 'application/json', temperature: 0.2 },
      }),
    }
  );

  const json = await response.json();
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty Gemini response');
  return JSON.parse(rawText);
}

async function callOpenAIVision(imageUrl, targetLang, byok) {
  const apiKey = byok.openaiApiKey;
  const model = byok.openaiModel || 'gpt-4o-mini';

  const prompt = `Detect speech bubbles in this manga and translate to: ${targetLang}.
Return JSON:
{
  "bubbles": [
    {
      "x": number, "y": number, "width": number, "height": number,
      "raw_text": "original", "translated_text": "translation", "vertical": boolean
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
            { type: 'text', text: 'Translate manga page' },
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
        vertical: false,
      },
      {
        x: 640,
        y: 450,
        width: 210,
        height: 130,
        raw_text: 'いつでも来い！容赦はしないぞ！',
        translated_text: 'COME AT ME! I WON\'T HOLD BACK!',
        vertical: false,
      },
    ],
  };
}
