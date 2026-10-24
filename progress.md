# Progress: Teo Diet App

## 2026-10-24
- Project created with `spec.md`, `progress.md`, and `CLAUDE.md`.
- Feature interview done. Decisions:
  - Platform: web app on GitHub Pages.
  - Version 1 includes macros, confirm/edit of Gemini estimates, and weight tracking.
  - Flexible days: both planned big days and automatic rebalancing.
  - Apple Health moved to Future Features.
- Next: answer the Open Questions in `spec.md`, then start building.

## 2026-10-24 (second interview)
- Answered all Open Questions and added specifics to `spec.md`:
  - Data stays on the phone, with Export/Import backup.
  - Week starts Monday.
  - Calorie floor set in Settings (default 1500); overage that doesn't fit is forgiven.
  - Exercise add-back percentage set in Settings (default 50%).
  - Weight in lbs.
  - Big days: default in Settings, can be changed for a specific week.
  - Added to v1: History (edit/delete past entries), Favorites, PWA home-screen install.
- Photo logging was not chosen for v1.
- Next: start building v1.

## 2026-10-24 (MVP build)
- Built a clickable MVP: `index.html`, `style.css`, `app.js`, `manifest.json`, `icon.svg`, `sw.js`.
- Tabs: Today (quick log, confirm/edit card, favorites, today's log, remaining calories + macros), Dashboard (this week + last 14 days bar charts), Weight (log + trend chart vs goal), History (browse/edit/delete any day), Settings (targets, add-back %, floor, big days default + this-week override, export/import).
- Gemini is NOT wired up yet: a placeholder keyword estimator stands in. The API key field exists but is unused.
- Added a "Extra calories per big day" setting (default 400) because planned big days need an amount. Needs Teo's confirmation; not yet in spec.
- Next: test on iPhone, confirm the big-day amount, then wire up Gemini.

## 2026-10-24 (Today tab + Gemini wired up)
- Added `js/gemini.js`: real Gemini call (`gemini-3.8-flash`, structured JSON output). Splits foods into items, estimates exercise burn using the latest logged weight, and shows friendly errors for missing/bad key, rate limit, network failure, and unreadable answers.
- Added `js/today.js` + `css/today.css`: log box (Enter to send, "chewing" ASCII spinner), editable confirm panel (switch eat/burn, remove/add items, retry, Save, Save + Fav, "By hand" entry without Gemini), day summary with big remaining number, ASCII fuel gauge, mood critter, macro meters, forgiven-overage note, favorites chips (one tap to re-log, edit mode to delete), and today's log with edit and two-tap delete.
- Checked at 375px and 320px with no sideways scrolling.
- Next: test on Teo's iPhone with a real API key.

## 2026-10-24 (real build, pixel style)
- Added design rules to `CLAUDE.md` (pixel art + ASCII, Silkscreen + VT323, no Inter/blue/cards/gradients/pill navs/generic empty states). Gemini model set to Gemini 3.8 Flash (`gemini-3.8-flash`, verified against Google docs).
- Replaced the MVP with a modular build: `js/store.js` (data + budget math), `js/main.js` (router), `css/base.css` (design system), then three builder agents in parallel:
  - Today tab + `js/gemini.js` (real Gemini structured-output call, confirm/edit, favorites, ASCII critter + fuel gauge).
  - Dashboard (pixel bar chart, week budget table, history strip) + Weight (pixel SVG trend, stats).
  - History (inline edit, back-fill), Settings (all fields, export/import/clipboard/wipe), PWA (manifest, `sw.js`, pixel apple icon).
- Integration fixes: 30s Gemini timeout; simplified the garbled header logo.
- Spec additions: "add by hand" manual entry, clipboard backup/restore, wipe.
- Next: QA agent testing on mobile viewports; then real-iPhone test with a live API key. Bump `CACHE` in `sw.js` on every deploy.

## 2026-10-24 (QA pass)
- Tested with Playwright on **WebKit 18.4** (closest to iOS Safari) and Chromium, emulating iPhone SE (320/375), iPhone 15 (393) and a 430px phone, in light and dark mode. Gemini was mocked (no real API calls), including 400/403/404/429/500, malformed JSON, blocked, empty and network-abort responses.
- Flows covered: first launch + empty states, Setup (key, targets, validation), log food/exercise/mixed, edit/remove/switch type in the confirm panel, retry, Save, Save + Fav, re-log and delete favorites, edit/delete from today's log, "By hand", History (day nav, date picker, inline edit, delete, back-fill food + exercise), Weight (log, replace, delete, chart, stats), Dashboard (week nav, bar tap, 14/30 day strip), export/import/clipboard/paste-restore/wipe, reload persistence, service worker offline (Chromium). 101/101 checks pass on WebKit.
- Budget math hand-checked with a Node script (planned big-day split, rebalancing, add-back %, floor + forgiven).
- Fixes:
  - `js/dash.js`: "Rebalanced" showed the whole overage even when most of it was forgiven; now shows only the part actually spread.
  - `js/store.js`: past weeks reported every overage (even Sunday's) as "forgiven at the floor". Past weeks are now shown as they stood on their Sunday.
  - CSS: raised small tap targets to 40px or more (today Edit/Del, dashboard 14d/30d + "back to this week", Setup "Use defaults", paste-restore toggle, add-back slider, History date picker).
  - `sw.js`: CACHE bumped to `teo-diet-v3`.
- Next: real-iPhone test with a live key (safe-area insets, dictation, home-screen install can't be fully emulated).

## 2026-10-24 (deployed)
- Browser upload had flattened the `css/` and `js/` folders, so the live page loaded unstyled. Re-pushed with git (folders intact) and bumped `sw.js` CACHE to v4.
- Live at https://teobobeo99.github.io/Teos-Diet-App/ (repo Teobobeo99/Teos-Diet-App, branch main).
- Next: test on iPhone with a real Gemini key; answer pending decisions (big-day extra, past-week targets, all-7-big-days).

## 2026-10-24 (login decision)
- Teo chose cloud sync over phone-only storage (changes the earlier interview decision).
- Decisions: Google sign-in via Firebase; Firestore sync; Gemini key syncs too; login is optional (app still works locally).
- Next: Teo creates a Firebase project and shares the web config; then build auth + sync.

## 2026-10-24 (cloud sync built)
- Firebase project `teo-diet` set up by Teo (Google sign-in, Firestore in production mode, owner-only rules, authorized domain teobobeo99.github.io).
- New `js/sync.js`: optional Google sign-in (popup), Firestore sync of entries (one doc each) + meta doc (settings incl. Gemini key, weights, favorites, week overrides). Offline cache on; Firebase SDK loads only when signed in. Sync status glyph in the top bar (☁✓ / ☁~ / ☁!).
- New `js/merge.js`: sign-in merge rules (entry union, remote deletions respected, first-sync union of lists, newer-side-wins after). Unit-tested in Node.
- `store.js`: `setSyncHook` + `applyRemote`. Setup tab: Account section; wipe warns it affects all synced devices. `sw.js` CACHE v5, caches Firebase SDK files.
- Tested: app loads with no errors in WebKit + Chromium; Google popup reaches account picker. Real sign-in + two-device sync not yet tested (needs Teo's Google account).
- Risk: Google popups can be finicky inside an iPhone home-screen app. Fallback plan: add Email/Password sign-in.

## 2026-10-24 (key test + lock, any Gemini model)
- `gemini.js`: `listModels`, `pickModel`, `testModel`; shared error handling that keeps Google's message (helps diagnose a key that "doesn't work").
- Setup: Gemini section is now its own panel. "Test key" → on success the key locks (masked to last 4, no Show button; Replace / Remove / Test again) and a model dropdown lists the key's models. Removed the Show button and free-text model field.
- Spec updated: model is selectable (Gemini 3.8 Flash stays the default when available).
- Tested in WebKit with mocked Google responses (bad key, good key, model switch, replace/cancel). Real key not yet tried.
- Also saved memory rules: never push without Teo asking; scan for secrets before any push.
- Not pushed (waiting for Teo).

## 2026-10-24 (key "can't reach Gemini" fix)
- Cause: Teo's saved key contained characters Safari won't put in a request header (invisible/zero-width chars, curly quotes, or "…" from the shortened key in AI Studio's list), so fetch threw before reaching Google. Verified in WebKit against the real API.
- Fix: `gemini.js` `cleanKey` strips whitespace/invisible chars/quotes; `keyProblem` explains shortened, too-short or malformed keys. `sw.js` CACHE v7.
- Not pushed yet.
