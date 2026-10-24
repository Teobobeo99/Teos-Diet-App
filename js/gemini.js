// Gemini client: turns plain-language "what I ate / did" text into store items.
// parseLog(text, { apiKey, model, weightLbs }) -> [{ name, cal, p, c, f, type: 'food' | 'burn' }]
import { DEFAULT_MODEL } from './store.js';

const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;

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

export async function parseLog(text, { apiKey, model, weightLbs } = {}) {
  text = String(text || '').trim();
  if (!apiKey) fail('No Gemini API key yet. Add one in Setup.');
  if (!text) fail('Type what you ate or did first.');

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(weightLbs) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
  };

  let res;
  try {
    res = await fetch(ENDPOINT(model || DEFAULT_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout?.(30000),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError') fail('Gemini took too long to answer. Try again.');
    fail('Can\'t reach Gemini. Check your connection and try again.');
  }

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const apiMsg = data?.error?.message || '';
    const status = data?.error?.status || '';
    if (res.status === 429) fail('Gemini rate limit hit. Wait a minute and try again.');
    if (res.status === 403 || /API.?key/i.test(apiMsg) || status === 'PERMISSION_DENIED')
      fail('Gemini rejected the API key. Double-check it in Setup.');
    if (res.status === 404) fail(`Model "${model || DEFAULT_MODEL}" not found. Check the model name in Setup.`);
    if (res.status === 400) fail(`Gemini didn't accept the request${apiMsg ? ': ' + apiMsg : '.'}`);
    if (res.status >= 500) fail('Gemini is having trouble right now. Try again in a moment.');
    fail(`Gemini error ${res.status}${apiMsg ? ': ' + apiMsg : ''}`);
  }

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
