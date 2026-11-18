# Licenses

- `chocolate-doom-COPYING.md`: Chocolate Doom 3.1.1, GPL-2.0-or-later.
  The compiled engine in `public/engine/doom.{js,wasm}` is a derivative work under the same license.
- `freedoom-COPYING.txt` and `freedoom-CREDITS.txt`: Freedoom 0.13.0 (`freedoom1.wad`, inside `public/engine/doom.data`), modified BSD license.
- `engine/bridge.c`, `engine/pre.js`, `engine/post.js`, `engine/patches/speed.patch`: original to this project, distributed under GPL-2.0-or-later as part of the combined engine.

Corresponding source for the shipped binary is in this repository: the exact upstream tarball in `engine/source/`, plus `engine/patches/speed.patch`, `engine/bridge.c`, `engine/pre.js` and `engine/post.js`.
`engine/source/SOURCE.md` names the tag and checksums.
`engine/build.sh` reproduces the binary from exactly that.
The test-only debug build in `tests/debug-engine/` is built from the same source with `-DAGENT_DEBUG` and is not served to viewers.
