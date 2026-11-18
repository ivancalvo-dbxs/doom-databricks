# Licenses

- `chocolate-doom-COPYING.md`: Chocolate Doom 3.1.1, GPL-2.0-or-later.
  The compiled engine in `public/engine/doom.{js,wasm}` is a derivative work under the same license.
- `freedoom-COPYING.txt` and `freedoom-CREDITS.txt`: Freedoom 0.13.0 (`freedoom1.wad`, inside `public/engine/doom.data`), modified BSD license.
- `engine/bridge.c`, `engine/pre.js`, `engine/post.js`, `engine/patches/speed.patch`: original to this project, distributed under GPL-2.0-or-later as part of the combined engine.

Corresponding source for the shipped binary: upstream tag `chocolate-doom-3.1.1` (https://github.com/chocolate-doom/chocolate-doom) plus the files in `engine/`.
`engine/build.sh` reproduces the binary from exactly that.
