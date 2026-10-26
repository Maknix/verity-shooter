# Verity Shooter

Vanilla JS + HTML/CSS + three.js (r160) + cannon-es physics. No Node.js / build step.

## Run
ES modules and the .glb need http, not file://. Pick one:
- Windows: double-click `run.bat`   - macOS/Linux: `./run.sh`   - or `python3 -m http.server 8000` in this folder
Then open http://localhost:8000 (needs internet once per load: three.js + cannon-es come from the jsDelivr CDN).

## Controls
WASD move - Shift sprint (forward) - Space jump - LMB fire (hold = auto) - RMB aim - R reload - Esc pause

## Layout
- js/weapon.js  viewmodel: your Verity-A .glb, procedural gloved arms (2-bone IK), all animation (idle, walk, sprint, sway, landing, ADS, spring recoil, bolt, reload). Tweak the `TUNE` block at the top.
- js/enemies.js Falsity AI (chase, wind-up, lunge) + blue smiley sphere mesh
- js/fx.js      GPU particles (muzzle, sparks, smoke, goo) + WebAudio sfx
- js/world.js   arena, cannon-es world, pushable crates
- js/main.js    input, player, shooting, waves, HUD
