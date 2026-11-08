// Vercel Serverless API: User Profile & API Key Management (Zero-Dependency Lightweight REST Engine)
// Authenticates via Google Identity Toolkit REST API, manages user profiles and API keys via Firestore REST API.
// Eliminates heavy native dependencies (firebase-admin/grpc) for 100% serverless uptime.

declare const process: any;

const firebaseApiKey =
  process.env.VITE_FIREBASE_API_KEY ||
  process.env.FIREBASE_API_KEY ||
  '';

const projectId =
  process.env.VITE_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  '';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// ============================================================
// Main Handler
// ============================================================

async function handler(req: any, res: any) {
  // Handle Web Request environment (Edge / Fetch runner)
  if (typeof Request !== 'undefined' && req instanceof Request && (!res || typeof res.status !== 'function')) {
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const url = new URL(req.url);
    const body = ['POST', 'PUT'].includes(method) ? await req.json().catch(() => ({})) : {};
    const provider = url.searchParams.get('provider') || undefined;
    const { status, data } = await handleRequest(method, authHeader, body, provider);
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // Standard Node.js Serverless runtime (req, res)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || null;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const provider = req.query?.provider || undefined;

  const { status, data } = await handleRequest(req.method, authHeader, body, provider);
  return res.status(status).json(data);
}

export default handler;
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };

// ============================================================
// CORS Headers
// ============================================================

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ============================================================
// Core Request Router
// ============================================================

async function handleRequest(
  method: string,
  authHeader: string | null,
  body: any,
  queryProvider?: string
): Promise<{ status: number; data: any }> {
  try {
    if (!firebaseApiKey || !projectId) {
      return { status: 500, data: { error: 'Server configuration error: Firebase environment variables are missing.' } };
    }

    // Auth verification
    if (!authHeader?.startsWith('Bearer ')) {
      return { status: 401, data: { error: 'Missing or invalid Authorization token. Please sign in via the extension.' } };
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
      return { status: 401, data: { error: 'Empty authentication token. Please sign in again.' } };
    }

    let uid: string;
    let email: string | undefined;
    try {
      const authUser = await verifyFirebaseToken(idToken);
      uid = authUser.uid;
      email = authUser.email;
    } catch {
      return {
        status: 401,
        data: { error: 'Your session has expired. Please click the extension icon and sign in to refresh.' },
      };
    }

    // Route by method
    switch (method.toUpperCase()) {
      case 'GET':
        return await handleGet(uid, email, idToken);
      case 'PUT':
        return await handlePut(uid, idToken, body);
      case 'POST':
        return await handlePost(uid, idToken, body);
      case 'DELETE':
        return await handleDelete(uid, idToken, queryProvider);
      default:
        return { status: 405, data: { error: 'Method not allowed' } };
    }
  } catch (err: any) {
    console.error('[User API Error]', err);
    return { status: 500, data: { error: err.message || 'Internal server error' } };
  }
}

// ============================================================
// GET — Fetch user profile + API keys
// ============================================================

async function handleGet(
  uid: string,
  email: string | undefined,
  idToken: string
): Promise<{ status: number; data: any }> {
  // Fetch user profile doc
  const profileUrl = `${FIRESTORE_BASE}/users/${uid}`;
  const profileRes = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  let profile: Record<string, any> = {
    mode: 'private',
    autoTranslate: false,
    targetLang: 'en',
    displayName: '',
    email: email || '',
  };

  if (profileRes.ok) {
    const profileJson = await profileRes.json();
    const parsed = parseFirestoreFields(profileJson.fields);
    profile = {
      mode: parsed.mode || 'private',
      autoTranslate: parsed.autoTranslate ?? false,
      targetLang: parsed.targetLang || 'en',
      displayName: parsed.displayName || '',
      email: parsed.email || email || '',
    };
  }

  // Fetch API keys subcollection
  const keysUrl = `${FIRESTORE_BASE}/users/${uid}/keys`;
  const keysRes = await fetch(keysUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  const keys: Array<{ provider: string; model: string; maskedKey: string; isShared: boolean }> = [];

  if (keysRes.ok) {
    const keysJson = await keysRes.json();
    if (keysJson.documents && keysJson.documents.length > 0) {
      for (const doc of keysJson.documents) {
        const data = parseFirestoreFields(doc.fields);
        if (data.apiKey) {
          keys.push({
            provider: data.provider || 'google',
            model: data.model || '',
            maskedKey: maskApiKey(data.apiKey),
            isShared: data.isShared ?? false,
          });
        }
      }
    }
  }

  return { status: 200, data: { profile, keys } };
}

// ============================================================
// PUT — Update profile fields
// ============================================================

async function handlePut(
  uid: string,
  idToken: string,
  body: any
): Promise<{ status: number; data: any }> {
  const allowedFields = ['mode', 'autoTranslate', 'targetLang'];
  const fieldsToUpdate: Record<string, any> = {};
  const fieldPaths: string[] = [];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      fieldPaths.push(field);
      if (typeof body[field] === 'boolean') {
        fieldsToUpdate[field] = { booleanValue: body[field] };
      } else {
        fieldsToUpdate[field] = { stringValue: String(body[field]) };
      }
    }
  }

  if (fieldPaths.length === 0) {
    return { status: 400, data: { error: 'No valid fields to update. Allowed: mode, autoTranslate, targetLang.' } };
  }

  // Build update mask query params
  const maskParams = fieldPaths.map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${FIRESTORE_BASE}/users/${uid}?${maskParams}`;

  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: fieldsToUpdate }),
  });

  if (!patchRes.ok) {
    const errJson = await patchRes.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Firestore PATCH failed with status ${patchRes.status}`);
  }

  return { status: 200, data: { success: true } };
}

// ============================================================
// POST — Add API key
// ============================================================

async function handlePost(
  uid: string,
  idToken: string,
  body: any
): Promise<{ status: number; data: any }> {
  const { provider, apiKey, model, isShared } = body;

  if (!provider || !apiKey) {
    return { status: 400, data: { error: 'Missing required fields: provider, apiKey.' } };
  }

  const now = new Date().toISOString();

  const keyFields: Record<string, any> = {
    provider: { stringValue: provider },
    apiKey: { stringValue: apiKey },
    model: { stringValue: model || '' },
    isActive: { booleanValue: true },
    isShared: { booleanValue: !!isShared },
    addedAt: { timestampValue: now },
    lastUsedAt: { nullValue: null },
    usageCount: { integerValue: '0' },
  };

  // Write to user's keys subcollection
  const keyUrl = `${FIRESTORE_BASE}/users/${uid}/keys/${provider}`;
  const keyRes = await fetch(keyUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: keyFields }),
  });

  if (!keyRes.ok) {
    const errJson = await keyRes.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Failed to save API key (status ${keyRes.status})`);
  }

  // If shared, also write to shared_keys collection
  if (isShared) {
    const sharedFields: Record<string, any> = {
      ...keyFields,
      addedBy: { stringValue: uid },
    };

    const sharedUrl = `${FIRESTORE_BASE}/shared_keys/${uid}_${provider}`;
    const sharedRes = await fetch(sharedUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields: sharedFields }),
    });

    if (!sharedRes.ok) {
      console.warn(`[User API] Failed to write shared key for ${uid}_${provider}: ${sharedRes.status}`);
    }
  }

  return { status: 200, data: { success: true } };
}

// ============================================================
// DELETE — Delete API key
// ============================================================

async function handleDelete(
  uid: string,
  idToken: string,
  provider?: string
): Promise<{ status: number; data: any }> {
  if (!provider) {
    return { status: 400, data: { error: 'Missing required query parameter: provider.' } };
  }

  // Delete from user's keys subcollection
  const keyUrl = `${FIRESTORE_BASE}/users/${uid}/keys/${provider}`;
  const deleteRes = await fetch(keyUrl, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!deleteRes.ok) {
    const errJson = await deleteRes.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Failed to delete API key (status ${deleteRes.status})`);
  }

  // Also try to delete from shared_keys (ignore errors)
  try {
    const sharedUrl = `${FIRESTORE_BASE}/shared_keys/${uid}_${provider}`;
    await fetch(sharedUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    // Silently ignore — shared key may not exist
  }

  return { status: 200, data: { success: true } };
}

// ============================================================
// Google REST API Helpers (Zero-Dependency)
// ============================================================

async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
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

function parseFirestoreFields(fields: Record<string, any> | undefined): Record<string, any> {
  if (!fields) return {};
  const res: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) res[key] = val.stringValue;
    else if ('booleanValue' in val) res[key] = val.booleanValue;
    else if ('integerValue' in val) res[key] = parseInt(val.integerValue, 10);
    else if ('doubleValue' in val) res[key] = val.doubleValue;
    else if ('timestampValue' in val) res[key] = val.timestampValue;
    else if ('nullValue' in val) res[key] = null;
  }
  return res;
}

// ============================================================
// Utility
// ============================================================

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return key;
  return '••••••••' + key.slice(-4);
}
