// Gemini client: turns plain-language "what I ate / did" text into store items.
// parseLog(text, { apiKey, model, weightLbs }) -> [{ name, cal, p, c, f, type: 'food' | 'burn' }]
import { DEFAULT_MODEL } from './store.js';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Short readable name with portion, e.g. "2 large eggs, scrambled"' },
          calories: { type: 'NUMBER', description: 'kcal eaten (food) or burned (exercise), positive number' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
          type: { type: 'STRING', enum: ['food', 'exercise'] },
        },
        required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'type'],
        propertyOrdering: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'type'],
      },
    },
  },
  required: ['items'],
};

function systemPrompt(weightLbs) {
  const who = weightLbs
    ? `The user is an adult who weighs about ${weightLbs} lbs; base exercise burn on that weight.`
    : 'Assume a typical adult (about 170 lbs) for exercise burn.';
  return [
    'You are a nutrition logger. Convert the user\'s message into a list of logged items.',
    '- Split multiple foods into separate items (e.g. "eggs and toast" -> eggs, toast). Keep a single composed dish (a burrito, a sandwich) as one item unless the user lists its parts.',
    '- Use realistic US portion sizes when no amount is given (restaurant portions if a restaurant or chain is named). Respect any quantities, sizes or brands mentioned.',
    '- Give calories and macros (grams of protein, carbs, fat) for the whole portion. Round to whole numbers.',
    `- Exercise or activity (running, walking, lifting, steps, sports) is type "exercise": calories = estimated calories burned, macros = 0. ${who}`,
    '- Food and drink is type "food". Water, black coffee and similar are fine to include with ~0 kcal.',
    '- Names: short, human, include the portion, e.g. "2 slices whole wheat toast", "Ran 3 mi".',
    '- If the message contains nothing loggable, return {"items": []}.',
  ].join('\n');
}

const fail = msg => { const e = new Error(msg); e.friendly = true; throw e; };
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Turn a failed Gemini response into a friendly error. Google's own message is kept so problems are diagnosable.
function apiError(res, data, model) {
  const apiMsg = data?.error?.message || '';
  const status = data?.error?.status || '';
  if (res.status === 429) fail('Gemini rate limit hit. Wait a minute and try again.' + (apiMsg ? ` (${apiMsg})` : ''));
  if (/API key not valid|API_KEY_INVALID/i.test(apiMsg)) fail('Google says this API key isn\'t valid. Copy it again from aistudio.google.com/apikey.');
  if (res.status === 403 || status === 'PERMISSION_DENIED') fail(`Google refused the key${apiMsg ? ': ' + apiMsg : '.'}`);
  if (res.status === 404) fail(`Model "${model || DEFAULT_MODEL}" isn't available for this key. Pick another model in Setup.`);
  if (res.status === 400) fail(`Gemini didn't accept the request${apiMsg ? ': ' + apiMsg : '.'}`);
  if (res.status >= 500) fail('Gemini is having trouble right now. Try again in a moment.');
  fail(`Gemini error ${res.status}${apiMsg ? ': ' + apiMsg : ''}`);
}

async function call(url, apiKey, init = {}) {
  try {
    return await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout?.(30000) });
  } catch (e) {
    if (e?.name === 'TimeoutError') fail('Gemini took too long to answer. Try again.');
    fail('Can\'t reach Gemini. Check your connection and try again.');
  }
}

// Gemini text models this key can use, newest first: [{ id, label }].
export async function listModels(apiKey) {
  if (!apiKey) fail('Paste a key first.');
  const res = await call(`${BASE}/models?pageSize=1000`, apiKey);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) apiError(res, data);
  return (data?.models || [])
    .filter(m => /^models\/gemini-/.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent')
      && !/embedding|image|tts|audio|live|vision/i.test(m.name))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

// Preferred model from a list: Gemini 3.8 Flash if offered, else the newest stable Flash, else the first one.
export function pickModel(models, current) {
  const ids = models.map(m => m.id);
  if (current && ids.includes(current)) return current;
  if (ids.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return ids.find(id => /flash/.test(id) && !/lite|preview|exp/.test(id)) || ids.find(id => /flash/.test(id)) || ids[0];
}

// Tiny real request to prove the key + model actually answer.
export async function testModel(apiKey, model) {
  const res = await call(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }] }),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) apiError(res, data, model);
}

export async function parseLog(text, { apiKey, model, weightLbs } = {}) {
  text = String(text || '').trim();
  if (!apiKey) fail('No Gemini API key yet. Add one in Setup.');
  if (!text) fail('Type what you ate or did first.');

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(weightLbs) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
  };

  const res = await call(`${BASE}/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, apiKey, {
    method: 'POST', body: JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) apiError(res, data, model);

  if (data?.promptFeedback?.blockReason) fail('Gemini blocked that message. Try rewording it.');
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const raw = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!raw) fail('Gemini sent back an empty answer. Try again.');

  return normalize(raw);
}

// Exported for testing: raw JSON text -> store items.
export function normalize(raw) {
  let obj;
  try {
    obj = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    fail('Couldn\'t understand Gemini\'s answer. Try again.');
  }
  const list = Array.isArray(obj) ? obj : obj?.items;
  if (!Array.isArray(list)) fail('Couldn\'t understand Gemini\'s answer. Try again.');
  const n = v => Math.max(0, Math.round(+v || 0));
  return list
    .filter(it => it && (it.name || it.calories))
    .map(it => {
      const burn = /^(exercise|burn)/i.test(it.type || '');
      return {
        name: String(it.name || (burn ? 'Exercise' : 'Food')).trim().slice(0, 80),
        cal: n(it.calories ?? it.cal),
        p: burn ? 0 : n(it.protein_g ?? it.p),
        c: burn ? 0 : n(it.carbs_g ?? it.c),
        f: burn ? 0 : n(it.fat_g ?? it.f),
        type: burn ? 'burn' : 'food',
      };
    });
}
