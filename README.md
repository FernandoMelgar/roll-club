# Roll Club

A small, responsive dice roller with animated 3D dice, sound, session history, and stats.

## Run it

No build step needed. Open `index.html` directly, or serve the folder locally:

```bash
cd roll-club
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Features

- Roll 1–6 dice with a fair, crypto-backed random number generator
- Animated 3D dice that land on the correct face
- Running total plus per-die results
- Session history and roll stats, saved in `localStorage`
- Optional sound effects with a mute toggle
- Full-screen dice table, with a CSS overlay fallback when the browser blocks the Fullscreen API
- Keyboard support (`Space` or `R` to roll, `Escape` to leave full screen)
- Responsive layout for desktop, tablet, and mobile
- Reduced-motion support and accessible live announcements

## Files

- `index.html` — page structure
- `styles.css` — layout, responsive styles, and animations
- `script.js` — dice logic, sound, history, stats, and persistence

The app loads DM Sans and Instrument Serif from Google Fonts, with system-font fallbacks if you are offline.
