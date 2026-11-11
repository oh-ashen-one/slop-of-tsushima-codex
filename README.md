# Slop of Tsushima (codex build)

A Ghost of Tsushima style golden-hour field that runs in the browser, shown in-game as "Golden Field". You start on foot in evening grassland, walk to a horse, mount it and ride, past a Japanese shrine with a torii and stone lanterns, and over a stream on a log bridge. This is the build made by the AI model codex, working autonomously in the AI Game Arena: the same brief was given to four models and the results were judged blind. Per the repo's original notes, this build placed 2nd, with strong atmosphere, and was frozen as built. It is a conversion of the open-source RED SANDS engine (three.js and WebGL2, MIT, by gillworks).

A sibling repo, `slop-of-tsushima`, holds the kimi build of the same brief.

## Give this to your agent

```text
Clone https://github.com/Ashen-Skool/slop-of-tsushima-codex.git (private repo, I already have access, use my existing git or gh login). The repo is about 1.9 GB, so a shallow clone (git clone --depth 1) is fine.

Read README.md, package.json, ARENA_SESSION_NOTES.md, BRIEF.md and INTEGRATION.md. Then run the game locally so I can play it:
1. Check that Node is 20.19 or newer, or 22.12 or newer. If not, stop and tell me.
2. Run `npm install`, then `npm run dev`.
3. Tell me the local URL that Vite prints and the controls listed in the README.
4. Run `npm test` and tell me the result.

Do not run the capture, scout, motion or metrics scripts unless I ask. Do not edit any files. If you need anything from me, stop and ask.
```

## What is in here

- `index.html`: the page, with the boot screen titled "Golden Field".
- `src/`: the game source, in folders `core`, `render`, `world`, `player`, `sim`, `audio`, `materials` and `ui`. `src/main.js` is the entry point. The shrine code is in `src/world/town/JapaneseShrine.js`.
- `public/assets/ronin.glb`: the character model. It is the only file in `public/assets/`.
- `tests/`: two Node test files, `shrine-approach.test.mjs` and `bridge-traversal.test.mjs`.
- `ARENA_SESSION_NOTES.md`: the model's own handoff notes: what it changed, what its critics found, what passed and what it could not verify. Read this before trusting any screenshot in the repo.
- `BRIEF.md`: the challenge brief the model was given.
- `INTEGRATION.md`: the staging notes that came with the brief: where to swap the character, the palette rules and the biggest gaps from the stock engine.
- `progress.html`: the live progress page the model kept updating. It links to images in `shots/` and `references/`. `references/` is not in this repo, so some pictures will not show.
- `shots/`: capture frames from the build run, in many folders named for the critic round or motion test that produced them.
- `tools/`: capture, motion, metrics and scoring scripts used during the build.
- `docs/PROCESS.md`, `docs/CRITIC.md`, `docs/CONTRACTS.md`: process and evaluation notes inherited from the engine project this build started from. They describe a different art target.
- `docs/media/`: five screenshots (hero, night, rider, storm, town).
- `vercel.json`: deployment headers for serving the built game.
- `LICENSE`: MIT, copyright gillworks.

## What you need

- Node.js 20.19 or newer, or 22.12 or newer (Vite 8 requires this), and npm.
- A browser with WebGL2.
- Nothing else to play. No API keys or accounts.
- Only for the optional tools:
  - Playwright (installed by `npm install`) and a Chromium browser it can launch. The capture scripts pass flags for Metal graphics, so they are written for macOS.
  - `python3` with `numpy` and `Pillow` for `npm run metrics` and `npm run motion`.

## How to run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (the dev server listens on 127.0.0.1; `.claude/launch.json` uses port 5173). Wait for the boot screen to finish.

Controls (from the in-game pause menu):

- `W A S D`: move and ride
- `Shift`: run, and urge the horse onward
- Mouse: look (click to capture the pointer)
- `E`: mount and dismount
- `Space`: hop
- `Ctrl`: crouch
- `H`: hide the interface
- `M`: mute
- `Esc`: pause menu

To check the logic tests, and to build and preview a production build:

```bash
npm test
npm run build
npm run preview
```

There is no `npm start` script and no `server.mjs` in this repo.

Other scripts in `package.json`:

- `npm run capture:fast`: render the canonical shots headless at lower cost, into `shots/latest`.
- `npm run capture`: the same at 1920 by 1080.
- `npm run smoke`: boot check that reports console errors.
- `npm run motion`: capture short motion sequences and analyze them.
- `npm run metrics`: score the captured shots.
- `npm run scout`: random-camera search for the ugliest frames.

## Good to know

- Graphics quality is chosen automatically from your memory and CPU cores. Force it with the URL parameter `?quality=low`, `medium`, `high` or `ultra`. The pause menu also has a Quality control that reloads the page.
- The model's notes record that the capture, smoke, motion and scout scripts were blocked in its build sandbox (Chromium was killed by a macOS permission error, and the sandbox refused the Vite listening socket). So its authors could not verify the final visuals by capture. Its notes say the production build and `npm test` (3 tests) passed. Treat visual quality as unverified by the build run, and check it by playing.
- Per the same notes, the frames in `shots/latest` are baseline frames from before the work and are not output of this build.
- The notes also say the walk, mount and ride clips in `ronin.glb` were effectively static, so the game adds code-driven gait and mount-contact motion on top of them.
- The Ghost of Tsushima reference frames named in `BRIEF.md` are copyrighted and are not in this repo. The side-by-side comparison workflow from the brief needs frames you supply yourself.
- `package.json` still carries the original name `red-sands` and its original description of a western. The game itself is the golden field build.
- The scripts in `tools/` and the notes in `docs/` come from an automated build run. Read them as process records, not as setup instructions.
