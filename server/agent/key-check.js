// Whether Anthropic or OpenAI takes an API key, asked before the key is kept
// so a wrong paste is caught where it was made rather than on the first turn
// it fails. The model list: it needs a key and spends nothing.
import Anthropic from '@anthropic-ai/sdk';

/** 'ok' when Anthropic took the key, 'rejected' when it said the key is not
 *  one it knows, 'unchecked' when it could not be asked (down, offline, slow). */
export async function checkAnthropicKey(key, { baseURL = 'https://api.anthropic.com', timeoutMs = 8000 } = {}) {
  const client = new Anthropic({ apiKey: key, baseURL, maxRetries: 0, timeout: timeoutMs });
  try {
    await client.models.list({ limit: 1 });
    return 'ok';
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return 'rejected';
    return 'unchecked';
  }
}

/** The same question of OpenAI, for Codex. A 401 is a key OpenAI does not
 *  know; anything else that is not an answer (a 403 from a key scoped away
 *  from the model list, an outage, a timeout) is a key that went unchecked. */
export async function checkOpenAIKey(key, { baseURL = 'https://api.openai.com', timeoutMs = 8000 } = {}) {
  try {
    const response = await fetch(new URL('/v1/models', baseURL), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return 'ok';
    return response.status === 401 ? 'rejected' : 'unchecked';
  } catch {
    return 'unchecked';
  }
}
