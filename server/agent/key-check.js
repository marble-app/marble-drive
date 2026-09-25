// Whether Anthropic takes an API key, asked before the key is kept so a wrong
// paste is caught where it was made rather than on the first turn it fails.
// The model list: it needs a key and spends nothing.
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
