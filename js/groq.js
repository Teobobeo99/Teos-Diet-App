// Groq client (OpenAI-compatible API). Same contract as gemini.js:
// parseLog(text, { apiKey, model, weightLbs }) -> [{ name, cal, p, c, f, type: 'food' | 'burn' }]
import { systemPrompt, normalize, cleanKey } from './gemini.js';

export { cleanKey };
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const BASE = 'https://api.groq.com/openai/v1';
const JSON_SHAPE = '\nRespond with only a JSON object shaped like {"items":[{"name":"...","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"type":"food"}]} where type is "food" or "exercise".';

const fail = msg => { const e = new Error(msg); e.friendly = true; throw e; };

export function keyProblem(key) {
  if (!key) return 'Paste a key first.';
  if (/…|\.\.\./.test(key)) return 'That looks like a shortened key. Groq only shows the full key once, when you create it. Make a new one at console.groq.com/keys.';
  if (/[^A-Za-z0-9_-]/.test(key)) return 'The key has characters a Groq key never has. Copy it again.';
  if (!key.startsWith('gsk_')) return 'Groq keys start with "gsk_". Copy it again from console.groq.com/keys.';
  if (key.length < 40) return `That key looks too short (${key.length} characters). Copy it again.`;
  return '';
}

function apiError(res, data, model) {
  const apiMsg = data?.error?.message || '';
  const code = data?.error?.code || '';
  if (res.status === 401 || code === 'invalid_api_key') fail('Groq says this API key isn\'t valid. Make a new one at console.groq.com/keys.');
  if (res.status === 429) fail('Groq rate limit hit. Wait a minute and try again.' + (apiMsg ? ` (${apiMsg})` : ''));
  if (res.status === 404 || code === 'model_not_found') fail(`Model "${model}" isn't available on Groq. Pick another model in Setup.`);
  if (res.status === 403) fail(`Groq refused the request${apiMsg ? ': ' + apiMsg : '.'}`);
  if (res.status === 400) fail(`Groq didn't accept the request${apiMsg ? ': ' + apiMsg : '.'}`);
  if (res.status >= 500) fail('Groq is having trouble right now. Try again in a moment.');
  fail(`Groq error ${res.status}${apiMsg ? ': ' + apiMsg : ''}`);
}

async function call(path, apiKey, init = {}, model) {
  const problem = keyProblem(apiKey);
  if (problem) fail(problem);
  let res;
  try {
    res = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout?.(30000) });
  } catch (e) {
    if (e?.name === 'TimeoutError') fail('Groq took too long to answer. Try again.');
    fail('Can\'t reach Groq. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) apiError(res, data, model);
  return data;
}

// Chat models this key can use: [{ id, label }]. Speech, safety-filter and TTS models are left out.
export async function listModels(apiKey) {
  const data = await call('/models', apiKey);
  return (data?.data || [])
    .filter(m => m.active !== false && !/whisper|guard|tts|playai|orpheus|distil/i.test(m.id))
    .map(m => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// Preferred model: the current one if still offered, else Llama 3.3 70B, else another large model.
export function pickModel(models, current) {
  const ids = models.map(m => m.id);
  if (current && ids.includes(current)) return current;
  if (ids.includes(DEFAULT_GROQ_MODEL)) return DEFAULT_GROQ_MODEL;
  return ids.find(id => /gpt-oss-120b/.test(id)) || ids.find(id => /70b/.test(id)) || ids[0];
}

export async function testModel(apiKey, model) {
  await call('/chat/completions', apiKey, {
    method: 'POST', body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 20 }),
  }, model);
}

export async function parseLog(text, { apiKey, model, weightLbs } = {}) {
  text = String(text || '').trim();
  if (!apiKey) fail('No Groq API key yet. Add one in Setup.');
  if (!text) fail('Type what you ate or did first.');
  model = model || DEFAULT_GROQ_MODEL;
  const data = await call('/chat/completions', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      model, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt(weightLbs) + JSON_SHAPE }, { role: 'user', content: text }],
    }),
  }, model);
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) fail('Groq sent back an empty answer. Try again.');
  return normalize(raw);
}
