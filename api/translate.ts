// Vercel Serverless API: Translation Proxy (Zero-Dependency Lightweight REST Engine)
// Authenticates via Google Identity Toolkit REST API, retrieves keys from Firestore REST API,
// and proxies the translation request to the AI provider.
// Eliminates heavy native dependencies (firebase-admin/grpc) for 100% serverless uptime.

declare const process: any;

export default async function handler(req: any, res: any) {
  // Handle Web Request environment (if invoked by Edge or Fetch runner)
  if (typeof Request !== 'undefined' && req instanceof Request && (!res || typeof res.status !== 'function')) {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const body = await req.json().catch(() => ({}));
    const { status, data } = await handleTranslateRequest(authHeader, body);
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Standard Node.js Serverless runtime (req, res)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || null;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  const { status, data } = await handleTranslateRequest(authHeader, body);
  return res.status(status).json(data);
}

export { handler as POST };

// ============================================================
// Core Translation Processing
// ============================================================

async function handleTranslateRequest(
  authHeader: string | null,
  body: any
): Promise<{ status: number; data: any }> {
  try {
    if (!authHeader?.startsWith('Bearer ')) {
      return { status: 401, data: { error: 'Missing or invalid Authorization token. Please sign in via the extension.' } };
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      return { status: 401, data: { error: 'Empty authentication token. Please sign in again.' } };
    }

    const firebaseApiKey =
      process.env.VITE_FIREBASE_API_KEY ||
      process.env.FIREBASE_API_KEY ||
      '';

    const projectId =
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID ||
      '';

    if (!firebaseApiKey || !projectId) {
      return { status: 500, data: { error: 'Server configuration error: Firebase environment variables are missing.' } };
    }

    // 1. Verify Firebase ID Token using Google Identity Toolkit REST API
    let uid: string;
    try {
      const authUser = await verifyFirebaseToken(idToken, firebaseApiKey);
      uid = authUser.uid;
    } catch {
      return {
        status: 401,
        data: { error: 'Your session has expired. Please click the extension icon and sign in to refresh.' },
      };
    }

    const { imageBase64, mimeType, targetLang = 'en', provider: requestedProvider } = body;
    if (!imageBase64) {
      return { status: 400, data: { error: 'Missing imageBase64 in request body.' } };
    }

    // 2. Fetch User Mode from Firestore
    const mode = await getUserMode(projectId, uid, idToken);

    // 3. Retrieve Key (from user's vault, or fallback to community pool if in shared mode)
    let keyInfo = await getUserKey(projectId, uid, idToken, requestedProvider);

    if (!keyInfo && mode === 'shared') {
      keyInfo = await getSharedKey(projectId, idToken, requestedProvider);
    }

    if (!keyInfo?.apiKey) {
      return {
        status: 403,
        data: {
          error:
            mode === 'shared'
              ? 'No active keys in the shared community pool right now. Please add an API key at manga-manhwa-translator.vercel.app.'
              : 'No active API key found in your Cloud Vault. Please add an API key at https://manga-manhwa-translator.vercel.app to start translating.',
        },
      };
    }

    // 4. Construct Vision Translation Prompt (High-Precision Comic & Manhwa Grounding)
    const prompt = `You are a master Manga, Manhwa, and Comic Translator.
Analyze this comic page image with extreme precision and exhaustive completeness.
Detect and translate EVERY SINGLE piece of foreign text across the entire page, including:
1. Standard dialogue speech bubbles (round, oval, square).
2. Spiky, jagged, starburst, explosive shout and screaming bubbles (e.g. dramatic dialogue like "정말... 즐겨도 되는 거냐고요!!"). DO NOT overlook or skip spiky/explosion speech bubbles!
3. Dark, black, and inverted speech bubbles.
4. Stylized sound effects (SFX / 의성어 / 의태어), exclamations, moans, and whispers (e.g. "찌릿", "하아", "읏", "크윽!!", "쿵", "솨악", "탁", "철썩") floating across panels, character bodies, or backgrounds.
5. Monologue, thought clouds, and narrative caption boxes.

Translate all text accurately and naturally into ${targetLang}.
Keep dialogue punchy, expressive, and formatted in natural comic style UPPERCASE.

Return STRICTLY a JSON object with this exact structure:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "<original foreign text>",
      "translated_text": "<NATURAL TRANSLATION IN UPPERCASE>",
      "background": "dark" | "white" | "transparent",
      "type": "dialogue" | "sfx" | "narration"
    }
  ]
}
CRITICAL DETECTION RULES:
- "box_2d" MUST be 4 integer coordinates [ymin, xmin, ymax, xmax] normalized on a 0 to 1000 scale.
- The bounding box MUST tightly and precisely enclose the FULL extent of the text or speech bubble interior. Do NOT crop or undersize the box — ensure ALL text characters are fully contained within the box.
- For wide horizontal text, the box must be wide. For tall vertical text, the box must be tall. Match the actual text shape exactly.
- For dark/black bubbles, set "background": "dark". For white/light bubbles (including spiky/jagged shout bubbles with white interiors), set "background": "white". For floating SFX with no bubble background, set "background": "transparent".
- Set "type": "sfx" for sound effects and onomatopoeia. Set "type": "narration" for caption boxes. Set "type": "dialogue" for speech bubbles.
- EXHAUSTIVE RECALL: Scan from top to bottom. Do NOT stop after detecting 5 or 6 items. If there are 10, 15, or 20 text items on the page, include ALL of them in the bubbles array.
- NEVER return an empty bubbles array if foreign text is visible on the image. Output valid JSON only, no markdown.`;

    // 5. Proxy Translation Request to AI Provider
    let result: any;
    const provider = keyInfo.provider;
    const model = keyInfo.model;
    const apiKey = keyInfo.apiKey;

    if (provider === 'openrouter') {
      result = await callOpenRouter(apiKey, model || 'google/gemini-2.0-flash-001', prompt, imageBase64, mimeType);
    } else if (provider === 'openai') {
      result = await callOpenAI(apiKey, model || 'gpt-4o-mini', prompt, imageBase64, mimeType);
    } else if (provider === 'anthropic') {
      result = await callAnthropic(apiKey, model || 'claude-3-5-haiku-20241022', prompt, imageBase64, mimeType);
    } else if (provider === 'groq') {
      result = await callGroq(apiKey, model || 'llama-3.2-11b-vision-preview', prompt, imageBase64, mimeType);
    } else {
      // Default: Google Gemini
      result = await callGemini(apiKey, model, prompt, imageBase64, mimeType);
    }

    return { status: 200, data: { success: true, result } };
  } catch (err: any) {
    console.error('[Translation Proxy Error]', err);
    return { status: 500, data: { error: err.message || 'Translation failed' } };
  }
}

// ============================================================
// Google REST API Helpers (Zero-Dependency)
// ============================================================

async function verifyFirebaseToken(idToken: string, apiKey: string): Promise<{ uid: string; email?: string }> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  const json = await res.json();
  if (!res.ok || !json.users?.[0]) {
    throw new Error(json.error?.message || 'Token verification failed');
  }

  return {
    uid: json.users[0].localId,
    email: json.users[0].email,
  };
}

async function getUserMode(projectId: string, uid: string, idToken: string): Promise<string> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return 'private';
    const json = await res.json();
    const data = parseFirestoreFields(json.fields);
    return data.mode || 'private';
  } catch {
    return 'private';
  }
}

async function getUserKey(
  projectId: string,
  uid: string,
  idToken: string,
  requestedProvider?: string
): Promise<{ apiKey: string; model: string; provider: string } | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/keys`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.documents || json.documents.length === 0) return null;

    // Check requested provider first
    for (const doc of json.documents) {
      const data = parseFirestoreFields(doc.fields);
      if (data.isActive !== false && data.apiKey) {
        if (!requestedProvider || data.provider === requestedProvider) {
          return {
            apiKey: data.apiKey,
            model: data.model || '',
            provider: data.provider || 'google',
          };
        }
      }
    }

    // Return first active key
    for (const doc of json.documents) {
      const data = parseFirestoreFields(doc.fields);
      if (data.isActive !== false && data.apiKey) {
        return {
          apiKey: data.apiKey,
          model: data.model || '',
          provider: data.provider || 'google',
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function getSharedKey(
  projectId: string,
  idToken: string,
  requestedProvider?: string
): Promise<{ apiKey: string; model: string; provider: string } | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shared_keys`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.documents || json.documents.length === 0) return null;

    for (const doc of json.documents) {
      const data = parseFirestoreFields(doc.fields);
      if (data.isActive !== false && data.apiKey) {
        if (!requestedProvider || data.provider === requestedProvider) {
          return {
            apiKey: data.apiKey,
            model: data.model || '',
            provider: data.provider || 'google',
          };
        }
      }
    }

    const first = parseFirestoreFields(json.documents[0].fields);
    if (first.apiKey) {
      return {
        apiKey: first.apiKey,
        model: first.model || '',
        provider: first.provider || 'google',
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseFirestoreFields(fields: Record<string, any> | undefined): Record<string, any> {
  if (!fields) return {};
  const res: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) res[key] = val.stringValue;
    else if ('booleanValue' in val) res[key] = val.booleanValue;
    else if ('integerValue' in val) res[key] = parseInt(val.integerValue, 10);
    else if ('doubleValue' in val) res[key] = val.doubleValue;
    else if ('timestampValue' in val) res[key] = val.timestampValue;
  }
  return res;
}

// ============================================================
// Model Normalization & Multimodal Vision Callers
// ============================================================

function normalizeGeminiModel(model?: string): string {
  if (!model) return 'gemini-3.5-flash';
  const m = model.toLowerCase().trim();
  if (m === 'gemini-3.8-flash' || m === 'auto') return 'gemini-3.5-flash';
  if (m === 'gemini-3.1-flash-lite') return 'gemini-3.5-flash-lite';
  return model.trim();
}

async function callGemini(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  let targetModel = normalizeGeminiModel(model);
  let safeMime = (mime || 'image/jpeg').trim();
  if (!safeMime.startsWith('image/')) safeMime = 'image/jpeg';

  const genConfig: any = {
    responseMimeType: 'application/json',
    maxOutputTokens: 4096,
    temperature: 0.1,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        bubbles: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              box_2d: {
                type: 'ARRAY',
                items: { type: 'INTEGER' },
                description: '[ymin, xmin, ymax, xmax] coordinates from 0 to 1000',
              },
              raw_text: { type: 'STRING' },
              translated_text: { type: 'STRING' },
              background: { type: 'STRING', enum: ['white', 'dark', 'transparent'] },
              type: { type: 'STRING', enum: ['dialogue', 'sfx', 'narration'] },
            },
            required: ['box_2d', 'translated_text'],
          },
        },
      },
      required: ['bubbles'],
    },
  };

  const makeRequest = async (mName: string, config: any) => {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: safeMime,
                    data: base64,
                  },
                },
              ],
            },
          ],
          generationConfig: config,
        }),
      }
    );
  };

  let res = await makeRequest(targetModel, genConfig);
  let json = await res.json();

  // 1. If responseSchema or generationConfig causes error, retry with simple JSON config
  if (!res.ok && (json.error?.message?.includes('schema') || json.error?.message?.includes('argument') || json.error?.message?.includes('generationConfig'))) {
    const fallbackConfig = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
    res = await makeRequest(targetModel, fallbackConfig);
    json = await res.json();
  }

  // 2. If model not found (404), fallback to stable gemini-2.5-flash
  if (!res.ok && (res.status === 404 || json.error?.code === 404)) {
    console.warn(`[Gemini Proxy] Model ${targetModel} returned 404, falling back to gemini-2.5-flash`);
    targetModel = 'gemini-2.5-flash';
    const fallbackConfig = { responseMimeType: 'application/json', maxOutputTokens: 4096 };
    res = await makeRequest(targetModel, fallbackConfig);
    json = await res.json();
  }

  if (!res.ok) {
    throw new Error(json.error?.message || `Gemini API error ${res.status}`);
  }

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseAiJson(raw);
}

async function callOpenRouter(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenRouter error ${res.status}`);
  return parseAiJson(json.choices?.[0]?.message?.content);
}

async function callOpenAI(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `OpenAI error ${res.status}`);
  return parseAiJson(json.choices?.[0]?.message?.content);
}

async function callAnthropic(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  let anthropicMime = mime;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(anthropicMime)) anthropicMime = 'image/jpeg';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: anthropicMime, data: base64 } }, { type: 'text', text: prompt }] }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Anthropic error ${res.status}`);
  return parseAiJson(json.content?.[0]?.text);
}

async function callGroq(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Groq error ${res.status}`);
  return parseAiJson(json.choices?.[0]?.message?.content);
}

function parseAiJson(raw: string | undefined): { bubbles: any[] } {
  if (!raw) throw new Error('AI returned empty response');
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

  const fb = cleaned.indexOf('{');
  const lb = cleaned.lastIndexOf('}');
  if (fb !== -1 && lb > fb) cleaned = cleaned.substring(fb, lb + 1);

  // Attempt 1: Standard JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.bubbles)) {
      return { bubbles: parsed.bubbles };
    }
  } catch (err) {
    // Continue to repair attempts
  }

  // Attempt 2: Sanitize common JSON errors (trailing commas, unescaped newlines in strings)
  try {
    let sanitized = cleaned
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
      // Replace unescaped control characters inside strings
      .replace(/[\u0000-\u001F]+/g, (match) => {
        if (match === '\n' || match === '\r') return ' ';
        return '';
      });

    const parsed = JSON.parse(sanitized);
    if (parsed && Array.isArray(parsed.bubbles)) {
      return { bubbles: parsed.bubbles };
    }
  } catch (err) {
    // Continue to repair attempts
  }

  // Attempt 3: Regex extraction of individual valid bubble objects
  // Recovers all complete bubbles even if output was truncated or corrupted mid-stream
  const recoveredBubbles: any[] = [];
  const bubbleRegex = /\{[^{}]*"box_2d"\s*:\s*\[([0-9\s,.-]+)\][^{}]*"translated_text"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}/gi;
  let match: RegExpExecArray | null;

  while ((match = bubbleRegex.exec(cleaned)) !== null) {
    try {
      const boxCoords = match[1].split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      const transText = match[2].replace(/\\"/g, '"').trim();
      if (boxCoords.length === 4 && transText) {
        // Look for optional background or raw_text within the matched block
        const block = match[0];
        const rawMatch = block.match(/"raw_text"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
        const bgMatch = block.match(/"background"\s*:\s*"(white|dark|transparent)"/i);
        const typeMatch = block.match(/"type"\s*:\s*"(dialogue|sfx|narration)"/i);

        recoveredBubbles.push({
          box_2d: boxCoords,
          translated_text: transText,
          raw_text: rawMatch ? rawMatch[1] : '',
          background: bgMatch ? bgMatch[1] : 'white',
          type: typeMatch ? typeMatch[1] : 'dialogue',
        });
      }
    } catch (_) {}
  }

  if (recoveredBubbles.length > 0) {
    return { bubbles: recoveredBubbles };
  }

  // Fallback: If absolutely no bubble could be extracted, throw friendly error
  throw new Error('AI produced an unparseable response. Please retry.');
}
