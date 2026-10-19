# Roll Club

<img width="1351" height="894" alt="Screenshot 2026-10-19 at 4 52 00 p m" src="https://github.com/user-attachments/assets/ca185343-cace-4c90-893a-bc9728fcaea4" />

A small, responsive dice roller with D6 and D20 dice, animated 3D graphics, sound, session history, and stats.

## Run it

No build step needed. Open `index.html` directly, or serve the folder locally:

```bash
cd roll-club
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Features

- Roll 1–6 D6 or D20 dice with a fair, crypto-backed random number generator
- True 3D six-face dice plus a rendered twenty-face icosahedron, both landing with the rolled result on top
- Top-down studio camera, face-aware shading, inset pips, and contact shadows
- Running total plus per-die results
- Separate session history and stats for D6 and D20 rolls, saved in `localStorage`
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

When adjusting the dice camera angle, keep `VIEW_ROTATION` in `script.js` in sync with the `.die-camera` transform in `styles.css` so the D6 and D20 views stay consistent.
