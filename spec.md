# Teo Diet App: Spec

## Overview
A calorie and macro tracker where you log food and exercise in plain language. You type or dictate something like "two eggs and toast with butter" or "ran 3 miles," and Gemini estimates the calories and macros. A dashboard shows how each day went against your target.

## Platform
- Static web app hosted on GitHub Pages.
- Mobile-first layout, usable from the iPhone home screen.
- Dictation uses the phone keyboard's built-in mic button. No custom speech recognition needed.
- Installable to the iPhone home screen as a PWA (manifest + icon) so it opens full-screen like an app.

## Visual Style
- Pixel art + ASCII art look: pixel fonts (Silkscreen + VT323), hard pixel borders, ASCII dividers and drawings, chunky bar charts.
- Warm retro palette (cream paper, ink, leaf green, tomato red, mustard); amber-phosphor dark mode.

## Data Storage
- All data is stored only on the phone (browser local storage).
- Settings has **Export** (download a backup file) and **Import** (restore from that file) buttons so data can survive clearing Safari or moving devices.

## Version 1 Features

### 1. Settings
- Field for the user's **Gemini API key**, stored only on the device.
- Daily calorie target.
- Macro targets (protein at minimum; carbs and fat optional).
- Goal weight (in lbs).
- Extra calories per big day (default 400). *Pending Teo's confirmation.*
- Exercise add-back percentage (default 50%).
- Minimum daily calorie floor (default 1500).
- Default planned big days (e.g. Saturday and Sunday).
- Export / Import data buttons, plus copy-backup-to-clipboard and restore-from-pasted-text (easier on iOS). Backups leave out the API key.
- Wipe-all-data option (type WIPE to confirm).

### 2. Quick Log (the main feature)
- The app opens straight to the log box so logging takes seconds.
- Uses the **Gemini 3.8 Flash** model.
- One text box for logging, typed or dictated.
- The entry is sent to Gemini, which returns structured items (name, calories, protein, carbs, fat) and whether each item is **food eaten** or **calories burned**.

- **Add by hand:** a manual entry option (no Gemini) for when there's no key or Gemini fails. Past days can be back-filled from History.

### 3. Confirm or Edit Before Saving
- Gemini's estimate is shown as an editable card.
- The user can change any number, remove items, or retry before saving.

### 4. Calories Burned
- Exercise entries add back to the day's remaining budget, but only by the add-back percentage set in Settings (default 50%), since estimates tend to run high.

### 5. Dashboard
- A chart with one bar per day showing calories eaten against that day's target, with over-target days clearly marked.
- Today's summary: calories remaining and macro progress.

### 6. Weight Tracking
- Log body weight in lbs.
- A trend chart showing progress toward the goal weight.

### 7. Flexible Days (both modes)
- The week runs **Monday to Sunday**.
- **Planned big days:** The weekly budget is the daily target × 7. Default big days are set in Settings (e.g. Saturday and Sunday) and can be changed for a specific week. The other days are lowered automatically so the week stays on budget.
- **Automatic rebalancing:** If the user goes over on any day, the extra is spread across the remaining days of the week.
- **Calorie floor:** No day is lowered below the floor (default 1500, set in Settings). Any overage that doesn't fit above the floor is forgiven and shown as a note, not carried into next week.

### 8. History
- Browse any previous day's log.
- Edit or delete past entries; totals and rebalancing update to match.

### 9. Favorites
- Save a confirmed entry as a favorite.
- Re-log a favorite with one tap, without calling Gemini.

## Future Features
- **Apple Health integration:** Pull step count and estimate calories burned. Note: a website can't read Apple Health directly. Options are an iOS Shortcut that sends steps to the app, or wrapping the app as a native iOS app later.

## Open Questions
- None right now.
