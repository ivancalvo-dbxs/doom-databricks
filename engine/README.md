# Doom engine

Chocolate Doom `chocolate-doom-3.1.1` compiled to WebAssembly with Emscripten 3.1.74, Freedoom 0.13.0 (`freedoom1.wad`) as game data.
The built files in `public/engine/` are committed, so deployers need no toolchain.

## Files

- `bridge.c`: the agent bridge, compiled into the engine as `src/doom/i_bridge.c`.
- `patches/speed.patch`: patches to upstream (time source, main loop, tic command hook, no screen melt).
- `pre.js`, `post.js`: set engine arguments, then expose `window.DoomBridge`.
- `source/`: vendored upstream tarball and `SOURCE.md` (tag, commit, checksums).
- `build.sh`: verifies emsdk version, tarball and WAD checksums, applies the patch with no fuzz to a fresh tree, builds, writes `public/engine/doom.{js,wasm,data}` and the test-only `tests/debug-engine/doom.{js,wasm}`.

## Page contract

The page needs `<canvas id="canvas">` before `<script src="/engine/doom.js">`.
`await DoomBridge.ready`, then use `observe()`, `setControls(mask)`, `setPaused(bool)`, `setSpeed(1|2|4|8)`.
Masks are in `public/controls.js`.
`observe()` returns `health, armor, ammo (-1 for fist), weapon, x, y, angle, gametic, paused, monsters[], pickups[]`.
`speed` is the current speed.
Monsters (live, in line of sight, at most 8) have `dist`, `angle` (degrees relative to facing, positive is left), `health`, `attacking`.
`attacking` is true only while the monster is in its missile or melee state chain, which ends where its run states (`A_Chase`) begin.
Pickups (within 768 map units, at most 8) have `dist` and `angle`.

## Speed

`setSpeed(n)` accepts only the numbers 1, 2, 4 and 8.
Anything else (3, 0, 2.5, "4", NaN) is ignored and the speed stays as it was.

Game time is wall time times the speed, frozen while paused (`agent_speed`, `agent_paused` in `i_timer.c`).
The single-player tic buffer limit in `d_loop.c` scales with speed, otherwise the engine caps near 5x.
A frame only runs when game time moved, so pausing never blocks the browser.
Time deltas over 100 ms are clamped, so a hidden tab does not fast-forward the game on return.

## Input

Keyboard, mouse and joystick SDL events are disabled at startup, and SDL's keyboard listener is pointed at a non-existent element.
Only `setControls` drives the player.

## Debug build

`tests/debug-engine/` is the same engine built with `-DAGENT_DEBUG`.
It adds `_agent_debug_spawn` (spawn a monster ahead of the player) and `_agent_debug_enable_input` (re-enable keyboard events, used as the negative control for the no-input test).
It is only referenced by tests and is never in `public/`, so viewers cannot reach it.

## Rebuild

Needs emsdk 3.1.74 exactly (`source emsdk_env.sh`), cmake, git, curl, unzip, perl.

    engine/build.sh

Set `DOOM_BUILD_DIR` to build outside `engine/.build`.
The game starts on E1M1 at skill 3 with sound disabled.
