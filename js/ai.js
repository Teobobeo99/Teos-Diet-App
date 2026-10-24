// The AI provider chosen in Setup (Gemini or Groq), with where each keeps its key and model in settings.
import { db } from './store.js';
import * as gemini from './gemini.js';
import * as groq from './groq.js';

export const PROVIDERS = {
  gemini: { id: 'gemini', mod: gemini, label: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey',
            fields: { key: 'apiKey', ok: 'keyOk', models: 'models', model: 'model' } },
  groq: { id: 'groq', mod: groq, label: 'Groq', keyUrl: 'https://console.groq.com/keys',
          fields: { key: 'groqKey', ok: 'groqKeyOk', models: 'groqModels', model: 'groqModel' } },
};

export const provider = (id = db.settings.provider) => PROVIDERS[id] || PROVIDERS.gemini;
export const hasKey = () => !!db.settings[provider().fields.key];

export function parseLog(text, opts = {}) {
  const p = provider(), s = db.settings;
  return p.mod.parseLog(text, { apiKey: s[p.fields.key], model: s[p.fields.model], ...opts });
}
