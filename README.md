# Skill Issue: Zagreb Weather Live Wallpaper

Dynamic desktop wallpaper for **CachyOS (KDE Plasma 6)** and **Windows (Lively Wallpaper)**.
This live wallpaper is part of **[no-skill-issue.com](https://no-skill-issue.com/)** (Croatian language version: **[tegobavjestine.com](https://tegobavjestine.com/)**).

It reuses the game's Zagreb Cathedral terrace background, physical day/night sun path, real moon phase, seasons, and night lights — with an always-visible read-only weather card.

---

## Try it in your browser

Nothing to install. Both pages show the same Zagreb terrace scene, and you can choose the weather, time and effects yourself.

### The wallpaper: [damirlukina88.github.io/live-zagreb-wallpaper](https://damirlukina88.github.io/live-zagreb-wallpaper/)

This is the page your desktop runs. By default it shows the real weather and time for Zagreb. To choose settings and effects, add them to the address after `#` and join them with `&`. Press Enter, then reload the page.

| Try | Link |
|---|---|
| English, a different city | [`#lang=en&city=Split`](https://damirlukina88.github.io/live-zagreb-wallpaper/#lang=en&city=Split) |
| Rain at dusk | [`#wx=63&clock=2026-11-13T16:40:00%2B01:00`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=63&clock=2026-11-13T16:40:00%2B01:00) |
| Thunderstorm with heavy hail at night | [`#wx=99&clock=2026-07-10T23:00:00%2B02:00`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=99&clock=2026-07-10T23:00:00%2B02:00) |
| Heavy snow with 20 cm lying, Advent lights | [`#wx=75&snow=20&advent=1&clock=2026-12-12T18:00:00%2B01:00`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=75&snow=20&advent=1&clock=2026-12-12T18:00:00%2B01:00) |
| Full moon on a clear night | [`#wx=0&clock=2026-11-24T22:00:00%2B01:00`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=0&clock=2026-11-24T22:00:00%2B01:00) |
| Fog in autumn, card bottom left | [`#wx=45&season=autumn&card=bl`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=45&season=autumn&card=bl) |
| Clear summer noon, no weather card | [`#wx=0&season=summer&clock=2026-07-10T12:00:00%2B02:00&showcard=0`](https://damirlukina88.github.io/live-zagreb-wallpaper/#wx=0&season=summer&clock=2026-07-10T12:00:00%2B02:00&showcard=0) |

What you can set:

- **Settings**: `city=<name>`, `lang=hr|en`, `quality=auto|low`, `fps=5-30` (frame rate in rain and snow), `card=tr|tl|br|bl` (corner of the weather card), `showcard=0|1`.
- **Weather**: `wx=<WMO code>`. `0` clear, `1`–`3` mainly clear to overcast, `45`/`48` fog, `51`–`57` drizzle, `61`–`67` rain, `71`–`77` snow, `80`–`82` showers, `85`/`86` snow showers, `95` thunderstorm, `96`/`99` thunderstorm with hail.
- **Sky and season**: `clock=<ISO time>` (moves the sun, moon and night lights; write `+` as `%2B`), `season=spring|summer|autumn|winter`, `seasonmix=autumn,winter,0.5` (halfway between two seasons), `cloud=<0-100>` (cloud cover in %), `winddir=<degrees the wind comes from>`.
- **Effects**: `snow=<cm lying>`, `dry=<0-1>` (how dry the terrace is), `advent=1|0` (string lights on the railing), `soontest=rain:40` (the card's "rain in 40 min" line; also `rain-until:30`, `snow:20`).

Your browser remembers your city, language, quality, frame rate and card choices until you change them the same way. The weather, time and effects are not remembered: open the page without them to see the real weather again. The full list, including the multi-display options, is under [Testing](#testing).

### The game's test server: [tegoba-vjestine.pages.dev](https://tegoba-vjestine.pages.dev/)

This is the test version of the game ([tegobavjestine.com](https://tegobavjestine.com/) is the live one). It uses the same background, and new changes appear here first. Click **🧪 TEST** in the bottom-left corner to open the test panel, where you can pick:

- **Weather**: any weather code from clear sky to a thunderstorm with heavy hail, by day or night, with wind from 0 to 50 km/h. *Real weather* switches back.
- **Sky time and season**: drag the sky through the day, and choose the season or let the date decide.
- **Look (holidays and events)**: Christmas, New Year's Eve, New Year's Day, Halloween, Valentine's, Carnival, Easter or Dan škole.
- **Music**: any track from the playlist.
- **Date and time**: set any date, or jump to the last 10 seconds of 31 December.
- **Easter eggs**: play the easter eggs of the current look, or the Hard-tier Matrix reveal.

The panel is only on the test server, and it is hidden while you play. You can also add `?lang=en` (or `?lang=hr`) to the address to change the language, and `?holiday=<look>` to open with a look already chosen, for example [`?holiday=christmas`](https://tegoba-vjestine.pages.dev/?holiday=christmas).

---

## Features

- **Self-contained, and the source of the background**: the background modules (`zagreb-bg.js`, `sun.js`, `moon.js`, `zagreb-lights.js`, `weather-bg.js`, `i18n.js`) live in [`src/game/`](src/game/) and the artwork in [`web/bg/`](web/bg/). The wallpaper is their source of truth: scene changes are made here first and sent to the game (Tegoba vještine) with `npm run push-game`. `zagreb-bg.js` also carries what only the wallpaper needs (still picture and adaptive quality, span, pause, glass side displays); the game keeps its own adaptations (no span, cloud shapes built in idle time for phones, its own minute timer).
- **Multiple displays**: *Clone* (the whole scene on every display) or *Span* (one scene over all displays: the terrace and weather card on one display, the same sky, sun, moon, clouds and weather continuing across the others, which show frosted glass lit like the scene, or, with the glass switched off, the sky alone).
- **Physical Day & Night Cycle**: Real astronomical sun altitude calculated from local time and city coordinates (smooth transitions through day, golden hour, blue hour, and night).
- **Realistic Moon & Seasons**: the moon rises, crosses the sky and sets where it really is, in its real phase. The seasons arrive on dates typical for Zagreb (spring 20 March, summer 1 June, autumn 8 October, winter 25 November; half a year later south of the equator), and the paintings cross-fade over about three weeks.
- **Live Weather**: Connects to the free Open-Meteo API with offline cache and fast boot retry. Supports clear, cloudy (the measured cloud cover, with distant clouds near the horizon), rain, snow, fog, thunderstorms and rainbows; clouds and rain follow the real wind direction; snow lies for as long as it is measured on the ground; the terrace dries after about two days without rain and half-freezes in sub-zero temperatures.
- **A living town**: windows go dark one by one between 22:00 and 01:00 and a few come back on before dawn; the cathedral's floodlights go out at midnight. From the first Advent Sunday to 6 January the railing carries string lights and the town stays up later.
- **Fullscreen Auto-Pause**:
  - **KDE Plasma 6**: watches `org.kde.taskmanager.TasksModel` for fullscreen or maximized windows on this display (or, by setting, on any display) on the current desktop and activity, and stops the animation while covered, keeping the last frame.
  - **Windows (Lively)**: follows Lively's own pause rules (`livelyWallpaperPlaybackChanged`).
- **Weather Card**: in the corner you choose (top right by default), or hidden; styled in the game's dark glass and CRT phosphor theme. Displays city, condition, temperature (°C in HR, °C/°F in EN), wind, the next rain or snow within two hours ("Rain in about 40 min", "Rain until 18:00"), sunrise/sunset, and 3-day forecast. All UI elements have `pointer-events: none` so mouse clicks pass through to desktop icons.
- **Bilingual**: Choice of **Hrvatski** or **English** in settings.
- **Battery first**: the picture is **still** in calm weather (redrawn once a minute for the sun, sky, clouds and lights) and animates only while rain, snow, hail or a storm falls, at a frame rate you set (15 fps by default). On battery power nothing animates. The still picture is drawn sharp at full resolution; animation uses half resolution.

---

## Building

Requires Node.js and Python 3 (for the zip archives).

```bash
npm install
npm run build
```

Sources live in [`src/`](src/): [`src/wallpaper/`](src/wallpaper/) is the wallpaper (entry, settings, weather card, Open-Meteo client, build script, Lively manifest), [`src/game/`](src/game/) the game modules it reuses. The build writes:
1. `web/` — the page deployed to GitHub Pages (`bg/` and `fonts/` there are source assets)
2. `kde/skill-issue-wallpaper/contents/web/` — offline copy inside the Plasma package
3. `dist/skill-issue-wallpaper-lively.zip` — Lively package
4. `dist/Live-Zagreb-Wallpaper-{Linux,Windows}-Setup.*` — setup archives

Nothing built is committed. GitHub Actions builds on every push to `main`, runs `verify` and the benchmark subset, and deploys `web/`; every desktop then updates itself within the hour. A `v*` tag also attaches the setup archives to a GitHub Release.

| Command | What it does |
|---|---|
| `npm run build` | builds everything above |
| `npm run verify` | manifests, versions, QML, security policy, render matrix (screenshots in `bench/shots/`) |
| `npm run bench` | frame rate and draw cost for **every weather type** (see [Benchmark](#benchmark)) |
| `npm run check` | build + verify + benchmark subset (what CI runs) |
| `npm run push-game -- <game test repo> [--dry-run]` | sends the wallpaper's background changes since the last push to the game's **test** repo (`TEGOBA-VJESTINE-TEST-SERVER`, branch `test`): a three-way merge per file that keeps the game's own adaptations, plus changed `web/bg/` art. Never the live repo, never commits or deploys; refuses if those game files have uncommitted changes. A conflict, or a merge that would call something the game does not define (a wallpaper-only helper such as `wallpaper()`), leaves the game's file untouched and puts the merged file in `bench/push-game/`: resolve it, copy it into the game, then `--mark <file>`. `src/game/.pushed/` records what was last sent; commit it |
| `npm run sync-game -- <game repo>` | the other way, rarely needed: merges a fix made in the game back into `src/game/` |

**Releasing a host-package change** (QML, settings, Lively properties): set the new version in `package.json`, `kde/.../metadata.json`, `main.qml` (`hostVersion`) and `LivelyInfo.json` (`#host=`); the build refuses to run if they differ. Raise that host's minimum in `MIN_HOST` (`kde` or `lively`) in `src/wallpaper/version.js` if its older packages must be told to update, then tag `v<version>`.

---

## Installation & Setup

### CachyOS / KDE Plasma 6 (Linux)

Download [`Live-Zagreb-Wallpaper-Linux-Setup.tar.gz`](https://github.com/DamirLukina88/live-zagreb-wallpaper/releases/latest/download/Live-Zagreb-Wallpaper-Linux-Setup.tar.gz) (or clone the repo; the installer then builds the page first, which needs Node.js) and run:
```bash
./linux/install.sh
```
Or from the extracted archive:
```bash
tar -xzf Live-Zagreb-Wallpaper-Linux-Setup.tar.gz
./install.sh
```

To enable:
1. Right-click on your desktop → **Configure Desktop and Wallpaper...** (Postavke radne površine i tapete).
2. Set **Wallpaper Type** to **Skill Issue: Zagreb Weather**.
3. In the settings tab, configure:
   - **Grad / City**: (e.g. `Zagreb`, `Split`, `Vienna`, `Tokyo`)
   - **Jezik / Language**: `Hrvatski` or `English`
   - **Kvaliteta / Quality**: *Automatic* (default) draws the still picture sharp, at the display's full resolution, and drops to half resolution only while rain or snow animates. *Always low* keeps half resolution all the time (least memory).
   - **Vremenska kartica / Weather card** and **Kut kartice / Card corner**: show or hide the card, and which corner of the scene display it sits in.
   - **Na bateriji / On battery**: off by default: on battery power nothing animates, rain and snow are a still picture too.
   - **Sličice/s za kišu i snijeg / Frame rate in rain & snow**: battery first. Every frame makes Plasma repaint the whole display, so in clear or cloudy weather the picture is **still**: the clouds stop and it is redrawn once a minute so the sun, moon, sky and night lights follow the clock. Only while rain, snow, hail or a storm is falling, or during the fade to new weather, does it run at this rate (15 fps by default, up to 30).
   - **Raspored / Layout**: *Clone* or *Span*. For Span, choose it on **every** display (Plasma keeps settings per display). Each display's position, size and orientation are read automatically and follow screen changes.
   - **Zaslon sa scenom / Scene display**: which display carries the terrace and weather card in Span; *Automatic* picks the main (primary) display, the one marked as main in System Settings → Display Configuration.
   - **Bočni zasloni / Side displays**: in Span, frosted glass on the displays beside the scene (on by default), or the sky alone.
   - **Poravnanje visine / Height alignment**: on the side displays, shift the picture up (+) or down (−) in pixels until the railing meets the scene display's at the same height on your desk (monitors of different sizes and scaling rarely line up exactly from Plasma's arrangement alone).
   - **Pauza / Pause**: pause when *this* display is covered, or when *any* display is.
   - **Izvor / Source**: *Bundled copy* uses the files inside the plugin instead of the online page (offline, or to try a local build).

### Windows (Lively Wallpaper)

Download [`Live-Zagreb-Wallpaper-Windows-Setup.zip`](https://github.com/DamirLukina88/live-zagreb-wallpaper/releases/latest/download/Live-Zagreb-Wallpaper-Windows-Setup.zip), extract it, and double-click **`Setup-Live-Zagreb-Wallpaper.bat`**.
- Automatically installs [Lively Wallpaper](https://rocksdanister.github.io/lively/) via `winget` if not already installed, starts Lively, and imports `skill-issue-wallpaper-lively.zip`.
- Right-click the wallpaper in Lively → **Customise** to configure city, language, quality, frame rate in rain and snow, whether to animate on battery, the weather card (shown or hidden, and its corner) and the frosted glass on the side displays. The behaviour is the same as on KDE: a still picture unless precipitation animates, and never animated on battery unless you allow it.
- **Updating**: the page updates itself. When the package itself is outdated the weather card says so; run the setup again and delete the old entry in Lively's library.
- **Multiple displays**: for *Clone* use Lively's *Per display* or *Duplicate* wallpaper layout. For *Span*, set Lively's layout to *Span*; the page sees that its window covers several displays (the wallpaper's own *Layout* setting is not needed). It places the scene on the real display layout from the browser (Window Management API) when that is allowed, on *Scene display* if set; otherwise on the display the browser reports, the largest one, usually the primary; failing both, it splits the width into *Displays side by side* equal parts. If the scene does not line up, switch on **Show display info** and the page prints what it knows about your displays.
- **Pause** is Lively's own setting (per display or all displays). With Lively's *Span* layout the wallpaper is a single window, so it pauses as a whole.

---

## Updates

The page (scene, weather, card) updates itself from GitHub Pages. The package around it (the Plasma plugin's QML and settings, the Lively package) does not. When the installed package is older than the page needs, the weather card shows one line: *Nova verzija dodatka: ponovno pokreni instalaciju / Plugin update available: run the installer again*. Run the setup again (on Plasma, then restart plasmashell).

## Benchmark

```bash
npm run build
npm run bench                                   # ~100 cases, writes bench/latest.md
npm run bench -- --compare bench/baseline.json  # fail on a >25 % draw-time regression
npm run bench -- --full                         # every code x day/night x layout x size
```

Headless Chromium loads the page for **every WMO weather code** the model knows, by day and night, in clone and span (scene display and frosted side display), at 1920×1080 and on a 4K display at 170 % scaling, on mains and on battery. Per case it records frames per second, mean and worst draw time, main-thread load and the canvas size, and it fails if calm weather or battery power draws anything, or if an animation exceeds the frame rate set.

Real GPU load on a Plasma desktop (AMD): start plasmashell with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:9333`, then `npm run bench -- --gpu --port 9333` (writes `bench/gpu-latest.md`; each case has its own paused baseline, because other programs use the GPU too).

## Testing

The page takes test overrides in the URL hash: `clock=<ISO time>`, `wx=<WMO weather code>`, `season=spring|summer|autumn|winter`, `seasonmix=autumn,winter,0.5`, `cloud=<0-100 %>`, `winddir=<degrees the wind comes from>`, `snow=<cm lying>`, `dry=<0-1>`, `advent=1|0`, `soontest=rain:40|rain-until:30|snow:20`, `power=battery|ac`, `quality=auto|low`, `card=tr|tl|br|bl`, `showcard=0|1`, `glass=0|1`, `displayinfo=1`, plus the span geometry `layout=span&view=x,y,w,h&desk=w,h&scene=x,y,w,h` (what KDE sends) or `layout=span&slots=3&slot=2` (Lively's equal-display fallback). Serve `web/` locally, for example `python3 -m http.server -d web 8765`, and open `http://localhost:8765/#clock=2026-11-13T16:40:00%2B01:00&wx=61`.
