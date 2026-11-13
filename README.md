# Skill Issue: Zagreb Weather Live Wallpaper

Dynamic desktop wallpaper for **CachyOS (KDE Plasma 6)** and **Windows (Lively Wallpaper)**.
Reuses the game's Zagreb Cathedral terrace background, physical day/night sun path, real moon phase, seasons, and night lights — with an always-visible read-only weather card.

---

## Features

- **No Game Files Modified**: Reads directly from `src/zagreb-bg.js`, `src/sun.js`, `src/zagreb-lights.js`, `src/weather-bg.js`, and `src/i18n.js` during build time.
- **Physical Day & Night Cycle**: Real astronomical sun altitude calculated from local time and city coordinates (smooth transitions through day, golden hour, blue hour, and night).
- **Realistic Moon & Seasons**: Computes the exact lunar illumination phase and swaps seasonal Zagreb terrace foliage (spring, summer, autumn, winter snow).
- **Live Weather**: Connects to the free Open-Meteo API with offline cache and fast boot retry. Supports clear, cloudy, rain, snow, fog, thunderstorms, rainbows, and half-frozen terrace in sub-zero temperatures.
- **Fullscreen Auto-Pause**:
  - **KDE Plasma 6**: Monitors `org.kde.taskmanager.TasksModel` and freezes `WebEngineView` (`LifecycleState.Frozen`) when any fullscreen or maximized window covers the screen.
  - **Windows (Lively)**: Uses Lively's native fullscreen/focus pause hooks.
- **Always-Visible Weather Card**: Fixed in the top-right corner, styled in the game's dark glass and CRT phosphor theme. Displays city, condition, temperature (°C in HR, °C/°F in EN), sunrise/sunset, and 3-day forecast. All UI elements have `pointer-events: none` so mouse clicks pass through to desktop icons.
- **Bilingual**: Choice of **Hrvatski** or **English** in settings.
- **Battery-Friendly / Calm Mode**: 30 FPS cap, calm motion, reduced CPU usage. An optional **Sharp** mode enables native full-resolution rendering.

---

## Building

Requires Node.js (uses the repository's existing `esbuild` dependency).

```bash
node studio/wallpaper/build.mjs
```

Outputs:
1. **KDE Plasma 6 Package**: `studio/wallpaper/dist/kde/skill-issue-wallpaper/`
2. **Lively Wallpaper Package**: `studio/wallpaper/dist/skill-issue-wallpaper-lively.zip`

---

## Installation & Setup

### CachyOS / KDE Plasma 6 (Linux)

Install for your user:
```bash
kpackagetool6 -t Plasma/Wallpaper -i studio/wallpaper/dist/kde/skill-issue-wallpaper
```

To update after rebuilding:
```bash
kpackagetool6 -t Plasma/Wallpaper -u studio/wallpaper/dist/kde/skill-issue-wallpaper
```

To enable:
1. Right-click on your desktop → **Configure Desktop and Wallpaper...** (Postavke radne površine i tapete).
2. Set **Wallpaper Type** to **Skill Issue: Zagreb Weather**.
3. In the settings tab, configure:
   - **Grad / City**: (e.g. `Zagreb`, `Split`, `Vienna`, `Tokyo`)
   - **Jezik / Language**: `Hrvatski` or `English`
   - **Kvaliteta / Quality**: Check *Sharp* for native full-resolution rendering.

### Windows (Lively Wallpaper)

1. Install [Lively Wallpaper](https://rocksdanister.github.io/lively/) (Free & Open Source).
2. Drag and drop `studio/wallpaper/dist/skill-issue-wallpaper-lively.zip` into the Lively window.
3. Select the wallpaper to activate it.
4. Right-click the wallpaper in Lively → **Customise** to configure city, language, and sharp mode.

---

## Automated Verification

To run the full validation suite (QML lint, JSON/ZIP manifest checks, live Open-Meteo DOM check, Chromium stderr/CSP audit, and 11-scenario render matrix):

```bash
node studio/wallpaper/verify.mjs
```

Screenshots are saved into `.gemini/antigravity/brain/.../screenshots/`.
