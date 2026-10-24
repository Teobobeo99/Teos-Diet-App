# CLAUDE.md: Teo Diet App

Instructions for Claude when working on this project.

## Rules
1. **Every new feature goes in `spec.md`.** Whenever Teo describes a new feature or idea, add it to `spec.md` before writing any code for it. Ideas meant for later go under "Future Features".
2. **Always update `progress.md`.** After any work session, change, or decision, add a dated entry to `progress.md` saying what was done, what changed, and what's next.
3. If a request conflicts with something already in `spec.md`, point out the conflict and ask which version wins before building.
4. Keep `spec.md` as the single source of truth for what the app should do.

## Project basics
- Static web app (HTML/CSS/JavaScript), hosted on GitHub Pages.
- Mobile-first: it will mostly be used on Teo's iPhone.
- AI features use **Gemini** (default model Gemini 3.8 Flash) or **Groq**, chosen in Settings, with a key the user enters there.
- The core use case: open the app any time, tell the AI what you ate or did, and it gets logged. Logging must be fast and front and center.

## Design rules
The app uses a **pixel art + ASCII art** style. Avoid these:
- **No Inter or Roboto.** Use the custom pairing: **Silkscreen** (headings, labels, buttons) + **VT323** (body, numbers, inputs).
- **No muted blue accents.** Stick to the app palette (cream/ink, leaf green, tomato red, mustard; amber phosphor in dark mode).
- **No card overuse.** Don't wrap every piece of content in a rounded white card with a soft shadow. Separate sections with ASCII rules, headers, and spacing.
- **No predictable gradients.** No purple-to-blue or neon glowing mesh gradients.
- **No one-shot mega sprawls.** Plan first, then build component by component.
- **No floating pill navbars by default.** No centered glassmorphism pill headers unless the project calls for it.
- **No generic empty states.** No gray-circle icons with "No data available". Empty states get custom context, such as an ASCII drawing plus a hint about what to do.
