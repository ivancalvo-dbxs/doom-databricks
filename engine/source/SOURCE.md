# Corresponding source

The engine in `public/engine/doom.{js,wasm}` is built from:

| Part | Where | Identity |
|---|---|---|
| Chocolate Doom 3.1.1, unmodified | `chocolate-doom-3.1.1.tar.gz` in this directory (`git archive` of the tag) | tag `chocolate-doom-3.1.1`, commit `410d96855b5df5410ff591a90efeafa889119224`, sha256 `1ec7a89a5fb57c9bb187e4ba543e71824dc8771fe7046842f57ea6b98201ef2e` |
| Our patch | `engine/patches/speed.patch` | applies with `patch -p1 --fuzz=0` |
| Our bridge | `engine/bridge.c` (copied to `src/doom/i_bridge.c`), `engine/pre.js`, `engine/post.js` | in this repository |
| Freedoom 0.13.0 (data, not code) | downloaded by `engine/build.sh` | zip sha256 `3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`, `freedoom1.wad` sha256 `7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d` |
| Emscripten | not vendored | exactly 3.1.74 (`engine/build.sh` refuses any other version) |

Verify the tarball: `shasum -a 256 chocolate-doom-3.1.1.tar.gz` and `gzip -dc chocolate-doom-3.1.1.tar.gz | git get-tar-commit-id`.
Rebuild: `engine/build.sh`.
