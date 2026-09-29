# TimeShift 3D

A calm, continuous 3D world (Three.js) that follows **local time** — morning, day, sunset, and night — with cinematic interpolation and a smooth performance budget.

## Features

### Performance
- Single `timeOfDay` value (0–24), lerped every frame; modes / scrubber only change the **target**
- Dynamic pixel ratio (auto lowers when FPS dips, raises when stable)
- Quality: Auto / Low / High (persisted in `localStorage`)
- One shadow light, shadow map updates only when the sun angle moves
- Instanced trees (layered canopies), rocks, bushes; GPU fireflies
- Pause rendering when the tab is hidden
- Camera inertia for lag-free drag / slide
- `?debug=1` FPS overlay

### Look
- 12 environment keyframes, smoothstep interpolation
- ACES Filmic tone mapping, soft PCF shadows, exponential fog
- Layered pine canopies, lake glitter, drifting clouds, birds / fireflies
- Warm window & lamp lights at dusk/night

### UI
- Time scrubber (0–24h) + timelapse (~60s full day) + pause (Space)
- Mode chips: AUTO / MORNING / DAY / SUNSET / NIGHT with relaxed icons
- Logo mark, dynamic greeting, timezone label
- Mute, quality menu, fullscreen
- Double-click canvas or press **U** to hide UI
- Shortcuts: **1–5** modes, **F** fullscreen, **M** mute, **Space** pause time

### Relax
- Soft ambient audio (Web Audio noise bed) after first tap; crossfades with time of day
- Prefers-reduced-motion respected
- Settings remembered (`mode`, `mute`, `quality`)

### PWA / a11y
- `manifest.json`, theme-color follows sky
- No `user-scalable=no`
- CSS gradient sky fallback if WebGL fails

## Run

```bash
npx serve .
# or open index.html via any static host / Vercel
```

Debug FPS: append `?debug=1`

## Structure

```
index.html  style.css  script.js  manifest.json  README.md
```

All geometry is procedural — no external 3D assets. Three.js r128 via CDN.
