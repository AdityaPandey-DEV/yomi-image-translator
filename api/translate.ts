// Vercel Serverless API: Translation Proxy
// Universal Node (req, res) + Web (Request) handler supporting Vercel Serverless Functions
// Authenticates via Firebase ID token, retrieves key from Firestore, proxies to AI provider.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminServices() {
  if (getApps().length === 0) {
    let serviceAccount: any = undefined;
    const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawSa) {
      try {
        serviceAccount = JSON.parse(rawSa);
      } catch (e) {
        console.error('[Firebase Admin Init] Error parsing FIREBASE_SERVICE_ACCOUNT JSON:', e);
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || 'sample-firebase-ai-app-fec3e';

    if (serviceAccount && serviceAccount.private_key) {
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp({ projectId });
    }
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

// ============================================================
// Core Translation Logic
// ============================================================

async function processTranslation({
  authHeader,
  body,
}: {
  authHeader: string | null;
  body: any;
}): Promise<{ status: number; data: any }> {
  try {
    if (!authHeader?.startsWith('Bearer ')) {
      return { status: 401, data: { error: 'Missing or invalid Authorization token. Please sign in.' } };
    }

    const idToken = authHeader.slice(7);
    const { auth, db } = getAdminServices();

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (authErr: any) {
      console.warn('[Firebase Auth Token Verify Error]', authErr?.message);
      return {
        status: 401,
        data: { error: 'Invalid or expired login session. Please sign in again on manga-manhwa-translator.vercel.app.' },
      };
    }

    const uid = decodedToken.uid;
    const { imageBase64, mimeType, targetLang, provider: requestedProvider } = body || {};

    if (!imageBase64 || !targetLang) {
      return { status: 400, data: { error: 'Missing required translation fields: imageBase64, targetLang' } };
    }

    // Determine translation mode & key
    const userDoc = await db.doc(`users/${uid}`).get();
    const userData = userDoc.data() || {};
    const mode = userData.mode || 'private';

    let provider = requestedProvider;
    let apiKey: string | null = null;
    let model: string = '';
    let keyDocRef: any = null;

    // A. Check user's specific provider key
    if (provider) {
      const docRef = db.doc(`users/${uid}/keys/${provider}`);
      const keyDoc = await docRef.get();
      if (keyDoc.exists) {
        const keyData = keyDoc.data()!;
        if (keyData.isActive && keyData.apiKey) {
          apiKey = keyData.apiKey;
          model = keyData.model || '';
          keyDocRef = docRef;
        }
      }
    }

    // B. Check ANY active personal key in user's vault
    if (!apiKey) {
      const userKeysSnap = await db.collection(`users/${uid}/keys`).where('isActive', '==', true).limit(1).get();
      if (!userKeysSnap.empty) {
        const firstDoc = userKeysSnap.docs[0];
        const keyData = firstDoc.data();
        provider = keyData.provider;
        apiKey = keyData.apiKey;
        model = keyData.model || '';
        keyDocRef = firstDoc.ref;
      }
    }

    // C. If still no personal key and in shared mode, pick from community pool
    if (!apiKey && mode === 'shared') {
      const poolSnap = await db
        .collection('shared_keys')
        .where('isActive', '==', true)
        .orderBy('usageCount', 'asc')
        .limit(1)
        .get();

      if (!poolSnap.empty) {
        const poolDoc = poolSnap.docs[0];
        const poolKey = poolDoc.data();
        provider = poolKey.provider;
        apiKey = poolKey.apiKey;
        model = poolKey.model || '';
        await poolDoc.ref.update({
          usageCount: (poolKey.usageCount || 0) + 1,
          lastUsedAt: new Date(),
        }).catch(() => {});
      }
    }

    if (!apiKey) {
      return {
        status: 403,
        data: {
          error:
            mode === 'shared'
              ? 'No active keys in the community pool right now. Please contribute an API key in your Cloud Vault to start translating.'
              : 'No active API key found in your Cloud Vault. Please add an API key at https://manga-manhwa-translator.vercel.app to start translating.',
        },
      };
    }

    // Vision prompt
    const prompt = `You are an expert Manga, Manhwa, and Comic Translator.
Analyze this comic page image. Locate every speech bubble, monologue box, and dialogue text.
Translate all dialogue naturally and accurately into ${targetLang}.
Return strictly a valid JSON object in this exact format:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "<original foreign text>",
      "translated_text": "<NATURAL TRANSLATION IN UPPERCASE>",
      "background": "white" | "dark" | "transparent"
    }
  ]
}
CRITICAL: box_2d uses 0-1000 normalized coordinates. Output valid JSON only, no markdown.`;

    let result;
    if (provider === 'google') {
      result = await callGemini(apiKey, model || 'gemini-3.8-flash', prompt, imageBase64, mimeType);
    } else if (provider === 'openrouter') {
      result = await callOpenRouter(apiKey, model || 'google/gemini-2.0-flash-001', prompt, imageBase64, mimeType);
    } else if (provider === 'openai') {
      result = await callOpenAI(apiKey, model || 'gpt-4o-mini', prompt, imageBase64, mimeType);
    } else if (provider === 'anthropic') {
      result = await callAnthropic(apiKey, model || 'claude-3-5-haiku-20241022', prompt, imageBase64, mimeType);
    } else if (provider === 'groq') {
      result = await callGroq(apiKey, model || 'llama-3.2-11b-vision-preview', prompt, imageBase64, mimeType);
    } else {
      result = await callGemini(apiKey, 'gemini-3.8-flash', prompt, imageBase64, mimeType);
    }

    // Increment personal usage counter
    if (keyDocRef) {
      const snap = await keyDocRef.get();
      if (snap.exists) {
        await keyDocRef.update({
          usageCount: ((snap.data()?.usageCount) || 0) + 1,
          lastUsedAt: new Date(),
        }).catch(() => {});
      }
    }

    return { status: 200, data: { success: true, result } };
  } catch (err: any) {
    console.error('[API /translate Error]', err);
    return { status: 500, data: { error: err.message || 'Translation proxy error' } };
  }
}

// ============================================================
// Standard Vercel Serverless Function Handler (Node.js)
// ============================================================

export default async function handler(req: any, res: any) {
  // If called in a Web Request environment (e.g. Edge runtime or test suite)
  if (req instanceof Request && (!res || typeof res.status !== 'function')) {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json().catch(() => ({}));
    const { status, data } = await processTranslation({ authHeader, body });
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Standard Node.js Vercel Serverless runtime
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
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  const { status, data } = await processTranslation({ authHeader, body });
  return res.status(status).json(data);
}

// Also export POST for Fetch API runners
export { handler as POST };

// ============================================================
// Multimodal Vision Callers
// ============================================================

async function callGemini(apiKey: string, model: string, prompt: string, base64: string, mime: string) {
  const genConfig: any = { response_mime_type: 'application/json' };
  if (model.includes('3.') || model.includes('2.5')) {
    genConfig.thinking_config = { thinking_budget: 0 };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || 'image/jpeg', data: base64 } }] }],
        generationConfig: genConfig,
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini API error ${res.status}`);
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

function parseAiJson(raw: string | undefined) {
  if (!raw) throw new Error('AI returned empty response');
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  const fb = cleaned.indexOf('{');
  const lb = cleaned.lastIndexOf('}');
  if (fb !== -1 && lb > fb) cleaned = cleaned.substring(fb, lb + 1);
  return JSON.parse(cleaned);
}
