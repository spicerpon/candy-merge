# Candy Merge 2048

Free Suika-style merge puzzle by **KOGAMES**, playable in the browser: https://kogames.dev/candy-merge/

- Pure HTML5 Canvas + JavaScript, no framework, no server, no database.
- Best score / recent records / gems / settings are stored only in the player's browser (localStorage with a cookie fallback).
- Languages: Korean, English, Japanese (auto-detected, switchable in game).

## Files
- `index.html`, `style.css` — page & UI
- `game.js` — bundled game (built from `src/` with `sh build.sh`)
- `src/` — readable sources (physics, i18n, save, audio, main)
- `assets/candy/01..11.webp` — candy sprites (blueberry → watermelon)

© KOGAMES. All rights reserved.
