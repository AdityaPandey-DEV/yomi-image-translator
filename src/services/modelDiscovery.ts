// Dynamic Model Discovery Client
// Connects to /api/models or direct provider endpoints for real-time model resolution.

export interface DynamicModel {
  id: string;
  name: string;
  description?: string;
  isCustom?: boolean;
}

const cache: Record<string, { timestamp: number; models: DynamicModel[]; isLive: boolean }> = {};
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

export async function fetchLiveModels(
  provider: string,
  apiKey?: string
): Promise<{ models: DynamicModel[]; isLive: boolean }> {
  const cacheKey = `${provider}:${(apiKey || '').slice(-6)}`;
  const cached = cache[cacheKey];

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { models: cached.models, isLive: cached.isLive };
  }

  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        cache[cacheKey] = {
          timestamp: Date.now(),
          models: data.models,
          isLive: !!data.isLive,
        };
        return { models: data.models, isLive: !!data.isLive };
      }
    }
  } catch (err) {
    console.warn('[Model Discovery] Falling back to client-side discovery:', err);
  }

  // Client-side fallback if /api/models is unavailable (e.g. static preview)
  if (provider === 'openrouter') {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (res.ok) {
        const data = await res.json();
        const models = (data.data || [])
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
            description: m.description ? m.description.slice(0, 80) + '...' : undefined,
          }))
          .slice(0, 40);

        if (models.length > 0) {
          return { models, isLive: true };
        }
      }
    } catch {
      // Ignore
    }
  }

  const defaultModels = getStaticCuratedModels(provider);
  return { models: defaultModels, isLive: false };
}

export function getStaticCuratedModels(provider: string): DynamicModel[] {
  switch (provider) {
    case 'google':
      return [
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Recommended · Frontier Vision)' },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Lowest Latency & Budget)' },
        { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro (Advanced Logic & Hard Dialogue)' },
        { id: 'gemini-3.0-pro', name: 'Gemini 3.0 Pro (Frontier Multimodal)' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Proven High-Speed Stable)' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deep Visual Reasoning)' },
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

