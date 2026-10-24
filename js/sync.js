// Cloud sync: optional Google sign-in (Firebase Auth) + Firestore.
// Cloud layout: users/{uid}/meta/state   = { settings, weights, favorites, weekOverrides, updatedAt }
//               users/{uid}/entries/{id} = one log entry
// The Firebase SDK is loaded only once someone signs in, so the app still works offline without it.
import { db, setSyncHook, applyRemote, toast } from './store.js';
import { metaOf, mergeOnSignIn, canon } from './merge.js';

const CDN = 'https://www.gstatic.com/firebasejs/11.0.2';
const CONFIG = {
  apiKey: 'AIzaSyAr8Bbel3Wlht899IZ0YVMnISSPAMoVFFs',
  authDomain: 'teo-diet.firebaseapp.com',
  projectId: 'teo-diet',
  storageBucket: 'teo-diet.firebasestorage.app',
  messagingSenderId: '363403170131',
  appId: '1:363403170131:web:c529e9d197451dfef911a6',
};
const FLAG = 'teoDietSignedIn';
const knownKey = uid => 'teoDietSynced:' + uid;  // entry ids this device has seen in the cloud
const META_AT = 'teoDietMetaAt';                  // when meta last changed on this device

let fb = null;            // { auth, A (auth module), F (firestore module), store }
let user = null;
let status = 'off';       // off | loading | synced | offline | error
let refs = null;          // { meta, entries }
let unsubs = [];
let cloudEntries = new Map(); // id -> JSON of the entry as the cloud has it
let cloudMeta = '';
let localMeta = '';      // meta as this device last saved it, to notice real settings changes
const listeners = new Set();

export const getUser = () => user;
export const getStatus = () => status;
export const onStatus = fn => listeners.add(fn);
function setStatus(s) {
  status = s;
  const dot = document.getElementById('sync-dot');
  if (dot) {
    dot.hidden = s === 'off';
    dot.textContent = { loading: '☁…', synced: '☁✓', offline: '☁~', error: '☁!' }[s] || '';
    dot.className = 'sync-dot sync-' + s;
    dot.title = { loading: 'Syncing', synced: 'Synced', offline: 'Offline: changes will sync later', error: 'Sync problem' }[s] || '';
  }
  listeners.forEach(fn => fn());
}

const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, canon(v)); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

async function load() {
  if (fb) return fb;
  const [appMod, A, F] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(CONFIG);
  let store;
  try { store = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }), ignoreUndefinedProperties: true }); }
  catch { store = F.getFirestore(app); }
  fb = { auth: A.getAuth(app), A, F, store };
  A.onAuthStateChanged(fb.auth, u => u ? attach(u) : detach());
  return fb;
}

// Called on startup: reconnect only if this device was signed in before.
export async function initSync() {
  setSyncHook(push);
  localMeta = canon(metaOf(db));
  if (!ls.get(FLAG, false)) return;
  setStatus('loading');
  try { await load(); } catch { setStatus('offline'); }
}

export async function signIn() {
  try {
    setStatus('loading');
    const { auth, A } = await load();
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    setStatus(user ? 'synced' : 'off');
    const code = e?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    toast(code === 'auth/unauthorized-domain' ? 'This site isn\'t allowed in Firebase yet (Authorized domains)'
      : code === 'auth/popup-blocked' ? 'Popup was blocked. Allow popups and try again'
      : !navigator.onLine ? 'You\'re offline. Sign in when connected'
      : 'Sign-in failed. Try again', 3200);
  }
}

export async function signOut() {
  if (!fb) return;
  ls.del(FLAG);
  await fb.A.signOut(fb.auth);
  toast('Signed out. Data stays on this device');
}

async function attach(u) {
  if (user?.uid === u.uid) return;
  user = u;
  ls.set(FLAG, true);
  setStatus('loading');
  const { F, store } = fb;
  refs = { meta: F.doc(store, 'users', u.uid, 'meta', 'state'), entries: F.collection(store, 'users', u.uid, 'entries') };
  try {
    const [m, es] = await Promise.all([F.getDoc(refs.meta), F.getDocs(refs.entries)]);
    const remote = { meta: m.exists() ? m.data() : null, entries: es.docs.map(d => d.data()) };
    const knownIds = ls.get(knownKey(u.uid), null);
    const merged = mergeOnSignIn(db, remote, { firstSync: !knownIds, knownIds: knownIds || [], localMetaAt: ls.get(META_AT, 0) });
    cloudEntries = new Map(remote.entries.map(e => [e.id, canon(e)]));
    cloudMeta = remote.meta ? canon(metaOf(remote.meta)) : '';
    applyRemote(merged);
    localMeta = canon(metaOf(db));
    push();
    listen();
  } catch (e) {
    console.error(e);
    setStatus('error');
  }
}

function detach() {
  unsubs.forEach(f => f()); unsubs = [];
  user = null; refs = null; cloudEntries = new Map(); cloudMeta = '';
  setStatus('off');
}

// Live updates from other devices. Our own writes show up here too (instantly, from the local cache).
function listen() {
  const { F } = fb;
  unsubs.push(F.onSnapshot(refs.entries, { includeMetadataChanges: true }, snap => {
    setStatus(snap.metadata.fromCache ? 'offline' : 'synced');
    const remote = new Map(snap.docs.map(d => [d.id, d.data()]));
    cloudEntries = new Map([...remote].map(([id, e]) => [id, canon(e)]));
    ls.set(knownKey(user.uid), [...remote.keys()]);
    const same = db.entries.length === remote.size && db.entries.every(e => cloudEntries.get(e.id) === canon(e));
    if (same) return;
    // Keep the local order for entries we already have, then add new ones.
    const entries = db.entries.filter(e => remote.has(e.id)).map(e => remote.get(e.id));
    const have = new Set(entries.map(e => e.id));
    for (const [id, e] of remote) if (!have.has(id)) entries.push(e);
    applyRemote({ ...db, entries });
  }, err => { console.error(err); setStatus('error'); }));

  unsubs.push(F.onSnapshot(refs.meta, snap => {
    if (!snap.exists()) return;
    const meta = metaOf(snap.data());
    cloudMeta = canon(meta);
    if (cloudMeta === canon(metaOf(db))) return;
    applyRemote({ ...db, ...meta });
    localMeta = cloudMeta;
  }, err => { console.error(err); setStatus('error'); }));
}

// Runs after every local save: write only what changed compared with the cloud.
function push() {
  const meta = canon(metaOf(db));
  if (meta !== localMeta) { localMeta = meta; ls.set(META_AT, Date.now()); }
  if (!user || !refs) return;
  const { F, store } = fb;
  const ops = [];
  const ids = new Set();
  for (const e of db.entries) {
    ids.add(e.id);
    const s = canon(e);
    if (cloudEntries.get(e.id) !== s) { ops.push(b => b.set(F.doc(refs.entries, e.id), e)); cloudEntries.set(e.id, s); }
  }
  for (const id of [...cloudEntries.keys()]) {
    if (!ids.has(id)) { ops.push(b => b.delete(F.doc(refs.entries, id))); cloudEntries.delete(id); }
  }
  if (meta !== cloudMeta) { ops.push(b => b.set(refs.meta, { ...metaOf(db), updatedAt: Date.now() })); cloudMeta = meta; }
  // Firestore batches hold up to 500 writes.
  for (let i = 0; i < ops.length; i += 450) {
    const batch = F.writeBatch(store);
    ops.slice(i, i + 450).forEach(op => op(batch));
    batch.commit().catch(e => { console.error(e); setStatus('error'); });
  }
}
