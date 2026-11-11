# EP-02 Codex main — session handoff (2026-08-26 EDT)

## Decisions and implementation

- Replaced the visible procedural cowboy with `public/assets/ronin.glb` while
  retaining the old rig invisibly as the proven physics/IK/saddle proxy.
- Mapped idle/walk/mount/ride to live player states. Direct GLB inspection
  found walk/mount/ride effectively static, so allocation-free gait and
  asymmetric mount-contact overlays now sit over the required named clips.
- Retuned the camera lower and wider for the reference composition.
- Shifted terrain/ecology from arid western masks to rolling gold/green meadow,
  dense 0.7–1.2 m grass, pampas plumes, white flowers, narrow pines and limited
  autumn broadleaf accents.
- Strengthened low-sun key/rim light, cool shadow structure, boundary haze,
  golden grade, deterministic petals and calm tea-green water.
- Replaced the western settlement at runtime with a torii/shrine precinct,
  enclosed walls, stone forecourt/stairs, eight budgeted lantern lights and a
  conditional log bridge. Static batching reduces these to 11 + 2 draws.
- Smoothed the whole journey as Golden Field / 黄金野 across boot, pause UI,
  region names, travel hints and shrine ambience.

## Gauntlet rounds

- Field critic: reference won; single gap was continuous luminous sward. Grass
  height floor/tip transmission tightened without added instances/draws.
- Landmark critic: reference won; single gap was open primitive blockout.
  Added enclosure, paving/stairs and real lantern pools, then batched geometry.
- Character critic: reference won; single gap was missing mount contact.
  Added left-stirrup/hand commitment, right-leg croup sweep and reversed
  dismount support ordering.
- Fresh whole-game smoothing pass completed after the critic wave.

## Receipts and known gap

- `npm run build`: PASS (127 modules).
- Syntax checks for every changed/new JS file: PASS.
- `git diff --check`: PASS.
- Deterministic landmark test: 11 shrine draws, 2 bridge draws, 8 non-zero
  lantern bases, finite bounds: PASS.
- `smoke`, `capture:fast`, and `motion`: the no-port disk route builds the
  current app, then Chromium is killed by macOS Mach-port permission denial
  (`bootstrap_check_in`, error 1100, SIGTRAP).
- `scout`: blocked earlier by the managed sandbox rejecting the Vite listen
  socket (`EPERM 127.0.0.1:5173`).
- Existing `shots/latest` are pre-wave staged baseline frames and must not be
  presented as current Codex output. Current visual parity remains unverified.

Canonical arena notes live outside this run's writable sandbox. The manager
should merge this handoff into the arena's notes for 2026-08-27 (not in this repo), then commit
and push from the arena root.

## Continuation — 2026-08-27 00:32 EDT

- Re-ran the production build successfully (127 modules).
- A fresh-context visual critic attempted `capture:fast`, `motion`, and
  `scout`; all three produced zero new files. Existing `shots/latest` remains
  the 23:36 EDT pre-wave baseline and was not scored as current output.
- Capture recovery tested bundled Chromium, full Chrome for Testing, and system
  Chrome. A single-process headless-shell mode exposed WebGL2, but the game did
  not reach `window.__GAME.ready` after more than three minutes. The temporary
  launcher fallback was reverted because it produced no valid evidence.
- Fresh source audit found one largest functional gap: the log bridge rendered
  above the stream but supplied no ground surface, so Player and Horse physics
  followed the streambed instead of crossing the deck.
- Bridge critic round 1 failed the arbitrary 46 m cap: both visible ends were
  still in live water and the physics approach continued invisibly beyond the
  mesh. Round 2 measures the complete wet run, requires dry endpoints, and puts
  its ramps inside the visible timber span.
- Bridge critic round 2 failed continuous collision against flat rendered
  boards. Round 3 quantizes the Terrain query to each individual plank's exact
  top and tests three points per approach board plus Player/Horse traversal in
  both directions.
- Round-3 bridge critic passed. Its independent production probe built a 61 m
  bridge over a 55 m wet span; all 91 merged board tops agreed with the terrain
  query within ~0.000002 m, both controllers crossed both directions, support
  stopped at the visible mesh, stream arrays were unchanged, and disposal
  removed the override.
- Current gates: `npm test` 3/3 passing, `npm run build` passing, `git diff
  --check` clean. Full visual parity is still unverified because every fresh
  browser capture path remains blocked and no stale frame was accepted.
