// Vercel Serverless API: Translation Proxy
// Verifies Firebase Auth token, retrieves user's API key from Firestore,
// and proxies the translation request to the AI provider.
// The API key NEVER touches the client in shared mode.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (serverless-safe)
if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : undefined;

  initializeApp(
    serviceAccount
      ? { credential: cert(serviceAccount) }
      : { projectId: process.env.FIREBASE_PROJECT_ID || '' }
  );
}

const adminAuth = getAuth();
const adminDb = getFirestore();

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Extract and verify Firebase ID token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch {
      return Response.json({ error: 'Invalid or expired authentication token. Please sign in again.' }, { status: 401 });
    }

    const uid = decodedToken.uid;

    // 2. Parse request body
    const body = await request.json();
    const { imageBase64, mimeType, targetLang, provider: requestedProvider } = body;

    if (!imageBase64 || !targetLang) {
      return Response.json({ error: 'Missing required fields: imageBase64, targetLang' }, { status: 400 });
    }

    // 3. Determine which API key to use
    const userDoc = await adminDb.doc(`users/${uid}`).get();
    const userData = userDoc.data() || {};
    const mode = userData.mode || 'private';
    const provider = requestedProvider || 'google';

    let apiKey: string | null = null;
    let model: string = '';

    // Try user's own key first
    const keyDoc = await adminDb.doc(`users/${uid}/keys/${provider}`).get();
    if (keyDoc.exists) {
      const keyData = keyDoc.data()!;
      if (keyData.isActive && keyData.apiKey) {
        apiKey = keyData.apiKey;
        model = keyData.model || '';
      }
    }

    // If no personal key and user is in shared mode, try the pool
    if (!apiKey && mode === 'shared') {
      const poolSnap = await adminDb
        .collection('shared_keys')
        .where('provider', '==', provider)
        .where('isActive', '==', true)
        .orderBy('usageCount', 'asc')
        .limit(1)
        .get();

      if (!poolSnap.empty) {
        const poolKey = poolSnap.docs[0].data();
        apiKey = poolKey.apiKey;
        model = poolKey.model || '';
        // Increment usage counter
        await poolSnap.docs[0].ref.update({
          usageCount: (poolKey.usageCount || 0) + 1,
          lastUsedAt: new Date(),
        });
      }
    }

    if (!apiKey) {
      return Response.json({
        error: `No API key found for ${provider}. Please add one in your dashboard, or switch to shared mode.`,
      }, { status: 403 });
    }

    // 4. Build the translation prompt
    const prompt = `You are an expert Manga, Manhwa, and Comic Translator.
Analyze this comic page image. Locate every speech bubble, monologue box, and dialogue text.
Translate all dialogue naturally and accurately into ${targetLang}.
Return strictly a valid JSON object:
{
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "raw_text": "<original text>",
      "translated_text": "<NATURAL TRANSLATION IN UPPERCASE>",
      "background": "white" | "dark" | "transparent"
    }
  ]
}
CRITICAL: box_2d uses 0-1000 normalized coordinates. Output valid JSON only.`;

    // 5. Proxy to the AI provider
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
      return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
    }

    // 6. Update usage counter for user's key
    if (keyDoc.exists) {
      await keyDoc.ref.update({
        usageCount: ((keyDoc.data()?.usageCount) || 0) + 1,
        lastUsedAt: new Date(),
      });
    }

    return Response.json({ success: true, result });
  } catch (err: any) {
    console.error('[API /translate]', err);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// --- AI Provider Proxies ---

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
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/,'');
  const fb = cleaned.indexOf('{');
  const lb = cleaned.lastIndexOf('}');
  if (fb !== -1 && lb > fb) cleaned = cleaned.substring(fb, lb + 1);
  return JSON.parse(cleaned);
}

