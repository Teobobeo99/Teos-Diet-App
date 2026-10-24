// Pure merge rules for cloud sync. No DOM or Firebase here, so they can be tested in Node.
export const metaOf = d => ({ settings: d.settings, weights: d.weights, favorites: d.favorites, weekOverrides: d.weekOverrides });

// JSON with sorted keys, so the same data always compares equal (Firestore doesn't keep key order).
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
export const canon = v => JSON.stringify(sortKeys(v));

const unionBy = (a = [], b = [], key) => [...new Map([...a, ...b].map(x => [x[key], x])).values()];

// Combine this device's data with the cloud's when signing in.
// - Entries: union by id. An entry this device synced before (knownIds) that is no longer
//   in the cloud was deleted on another device, so it is dropped instead of resurrected.
// - Meta (settings, weights, favorites, week overrides): on this device's first sync the lists
//   are unioned and cloud settings win; after that, whichever side changed last wins.
// - AI keys fall back to whichever side has one.
export function mergeOnSignIn(local, remote, { firstSync, knownIds = [], localMetaAt = 0 }) {
  const known = new Set(knownIds);
  const cloud = new Map(remote.entries.map(e => [e.id, e]));
  const entries = [];
  for (const e of local.entries) {
    if (cloud.has(e.id)) { entries.push(e); cloud.delete(e.id); }
    else if (!known.has(e.id)) entries.push(e);
  }
  entries.push(...cloud.values());

  const rm = remote.meta;
  let meta;
  if (!rm) meta = metaOf(local);
  else if (firstSync) meta = {
    settings: { ...local.settings, ...rm.settings },
    weights: unionBy(local.weights, rm.weights, 'date'),
    favorites: unionBy(local.favorites, rm.favorites, 'id'),
    weekOverrides: { ...rm.weekOverrides, ...local.weekOverrides },
  };
  else meta = (rm.updatedAt || 0) >= localMetaAt ? metaOf({ ...local, ...rm }) : metaOf(local);

  const keep = k => meta.settings[k] || local.settings[k] || rm?.settings?.[k] || '';
  meta.settings = { ...meta.settings, apiKey: keep('apiKey'), groqKey: keep('groqKey') };
  return { ...local, ...meta, entries };
}
