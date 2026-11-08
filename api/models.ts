// Vercel Serverless API: Dynamic Model Discovery
// Fetches live models directly from AI provider endpoints in real-time.
// Bypasses browser CORS restrictions and provides instant model discovery.

declare const process: any;

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let provider = 'google';
  let apiKey = '';

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    provider = body.provider || 'google';
    apiKey = (body.apiKey || '').trim();
  } else {
    provider = (req.query?.provider as string) || 'google';
    apiKey = ((req.query?.apiKey as string) || '').trim();
  }

  try {
    const { isLive, models } = await fetchProviderModels(provider, apiKey);
    return res.status(200).json({ provider, isLive, models });
  } catch (err: any) {
    console.warn(`[Model Discovery Error] Provider ${provider}:`, err?.message);
    const fallback = getCuratedModels(provider);
    return res.status(200).json({ provider, isLive: false, models: fallback, error: err?.message });
  }
}

export { handler as POST };

// ============================================================
// Provider Model Fetchers
// ============================================================

async function fetchProviderModels(
  provider: string,
  apiKey: string
): Promise<{ isLive: boolean; models: Array<{ id: string; name: string; description?: string }> }> {
  // 1. OpenRouter (Public endpoint, works with or without key)
  if (provider === 'openrouter') {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.data)) {
      const models = data.data
        .filter((m: any) => {
          const isVision =
            m.architecture?.input_modalities?.includes('image') ||
            m.architecture?.modality?.includes('image') ||
            m.id?.includes('flash') ||
            m.id?.includes('vision');
          return isVision && !m.id?.endsWith(':batch');
        })
        .map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description ? m.description.slice(0, 100) + '...' : undefined,
        }))
        .slice(0, 50); // Top 50 vision models

      return { isLive: true, models };
    }
  }

  // 2. Google Gemini (Requires API Key)
  if (provider === 'google' && apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Google API HTTP ${res.status}`);
    }
    const data = await res.json();

    if (Array.isArray(data?.models)) {
      const models = data.models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => {
          const id = m.name?.replace(/^models\//, '') || '';
          return {
            id,
            name: m.displayName ? `${m.displayName} (${id})` : id,
            description: m.description,
          };
        })
        .filter((m: any) => m.id.includes('gemini'));

      return { isLive: true, models };
    }
  }

  // 3. OpenAI (Requires API Key)
  if (provider === 'openai' && apiKey) {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.data)) {
      const models = data.data
        .filter((m: any) => {
          const id = m.id.toLowerCase();
          return (
            (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) &&
            !id.includes('audio') &&
            !id.includes('realtime') &&
            !id.includes('instruct') &&
            !id.includes('tts') &&
            !id.includes('whisper')
          );
        })
        .map((m: any) => ({
          id: m.id,
          name: m.id,
        }))
        .sort((a: any, b: any) => b.id.localeCompare(a.id));

      return { isLive: true, models };
    }
  }

  // 4. Groq (Requires API Key)
  if (provider === 'groq' && apiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.data)) {
      const models = data.data
        .filter((m: any) => m.id.includes('vision') || m.id.includes('llama-3.2') || m.id.includes('preview'))
        .map((m: any) => ({
          id: m.id,
          name: m.id,
        }));

      return { isLive: true, models };
    }
  }

  // 5. DeepSeek (Requires API Key)
  if (provider === 'deepseek' && apiKey) {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.data)) {
      const models = data.data.map((m: any) => ({
        id: m.id,
        name: m.id,
      }));

      return { isLive: true, models };
    }
  }

  // 6. Anthropic (Requires API Key)
  if (provider === 'anthropic' && apiKey) {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.data)) {
      const models = data.data.map((m: any) => ({
        id: m.id,
        name: m.display_name ? `${m.display_name} (${m.id})` : m.id,
      }));

      return { isLive: true, models };
    }
  }

  // Fallback to latest curated 2026 models
  return { isLive: false, models: getCuratedModels(provider) };
}

// ============================================================
// Curated 2026 Baseline Fallback Models
// ============================================================

function getCuratedModels(provider: string) {
  switch (provider) {
    case 'google':
      return [
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Recommended · Fastest Frontier Vision)' },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Lowest Latency & Budget)' },
        { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Advanced Logic & Hard Dialogue)' },
        { id: 'gemini-3.0-pro', name: 'Gemini 3.0 Pro (Frontier Multimodal)' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Proven High-Speed Stable)' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deep Multimodal Reasoning)' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Stable Workhorse)' },
      ];
    case 'openrouter':
      return [
        { id: 'google/gemini-3.5-flash', name: 'Google Gemini 3.5 Flash' },
        { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
        { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
        { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o Flagship' },
        { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic Claude Sonnet 5.5' },
        { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic Claude Haiku 5.5' },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
      ];
    case 'openai':
      return [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Budget Multimodal)' },
        { id: 'gpt-4o', name: 'GPT-4o (Omni Multimodal Standard)' },
        { id: 'gpt-4.5', name: 'GPT-4.5 (Frontier Deep Visual Intuition)' },
        { id: 'o3-mini', name: 'o3-mini (High-Speed Reasoning)' },
      ];
    case 'anthropic':
      return [
        { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5 (Flagship Balanced)' },
        { id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5 (Ultra Fast Vision)' },
        { id: 'claude-opus-5.5', name: 'Claude Opus 5.5 (Frontier Reasoning)' },
        { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Classic)' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Classic)' },
      ];
    case 'groq':
      return [
        { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision (Ultra Fast)' },
        { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision (High Capacity)' },
      ];
    case 'deepseek':
      return [
        { id: 'deepseek-chat', name: 'DeepSeek V3 (Fast Multilingual Reasoning)' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Advanced Chain of Thought)' },
      ];
    default:
      return [{ id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' }];
  }
}
