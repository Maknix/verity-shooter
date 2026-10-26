vibecoding test pls ignore this repository

# Verity Shooter

Vanilla JS + HTML/CSS + three.js (r160) + cannon-es physics. No Node.js / build step.

## Run
ES modules and the .glb need http, not file://. Pick one:
- Windows: double-click `run.bat`   - macOS/Linux: `./run.sh`   - or `python3 -m http.server 8000` in this folder
Then open http://localhost:8000 (needs internet once per load: three.js + cannon-es come from the jsDelivr CDN).

## Controls
WASD move - Shift sprint (forward) - Space jump - C / Ctrl slide (cancel with Space = slide-hop, Shift = into sprint, C again) - LMB fire (hold = auto) - RMB aim - R reload - F supply station (when standing next to it) - Esc pause

## Game loop
- Kill Verities to earn TRUTH. Clearing a wave gives a bonus + a little ammo, then a 10 s intermission - go to the golden SUPPLY STATION (arrow on the HUD points to it).
- Ammo is limited: magazine + spare rounds. Buy rounds, repairs and weapon upgrades (damage, fire rate, magazine, reload, recoil, ammo pouch, max integrity) at the station. The fight is paused while the shop is open.
- New enemy types unlock as the waves go on (a card pops up the first time you meet one). Every 3rd wave ends with a giant elite (ranged elites fire a radial nova). Waves are big and get tougher fast - health regen is slow, so use the park's hedges, trees and fountain for cover.

| Type | Unlocks | Behaviour |
|---|---|---|
| Falsity | wave 1 | standard melee |
| Lovity | 2 | fast and fragile |
| Curiosity | 3 | circles you, strikes from the side |
| Cruelty | 4 | slow wind-up, huge damage |
| Helpity | 6 | hangs back and heals other enemies |
| Buildity | 5 | slow tank, resists knockback |
| Sadity | 3 | ranged: fan of three tears |
| Cloudity | 5 | ranged: spits clouds (you can shoot them down) |
| Heartity | 6 | ranged: slow homing hearts (shoot them down) |
| Squareity | 9 | ranged: rapid 4-shot bursts |
| Boredity | 7 | sleeps until woken or approached, then rages |
| Mineity | 8 | rushes you and detonates |
| Evility | 10 | fast, strong, relentless |

Add or tune types in the `TYPES` table at the top of `js/enemies.js`. Shop prices / upgrade effects are in the `UPGRADES` list in `js/main.js`.
Console helpers: `__verity.game.credits = 5000`, `__verity.game.wave = 9`, `__verity.game.spawn('mineity', 3)`.

## Layout
- js/weapon.js  viewmodel: your Verity-A .glb, procedural gloved arms (2-bone IK), all animation (idle, walk, sprint, slide, sway, landing, ADS, spring recoil, bolt, reload). Tweak the `TUNE` block at the top.
- js/enemies.js the Verity types + AI (melee, orbit, ranged, healer, kamikaze, sleeper)
- js/fx.js      GPU particles (muzzle, sparks, smoke, goo, kill / explosion effects) + WebAudio sfx
- js/world.js   Verity Park map (paths, hedges, trees, fountain, pond, playground, gazebo...), cannon-es world, pushable crates, supply station
- js/main.js    input, player, slide, shooting, waves, economy + shop, HUD
