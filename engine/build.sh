#!/usr/bin/env bash
# Rebuilds public/engine/doom.{js,wasm,data}. Needs emsdk (emcc, emcmake) and cmake on PATH.
# Output is committed, so deployers never need this.
set -euo pipefail

CHOCOLATE_TAG=chocolate-doom-3.1.1
FREEDOOM_URL=https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip

here=$(cd "$(dirname "$0")" && pwd)
out=$here/../public/engine
work=${DOOM_BUILD_DIR:-$here/.build}
mkdir -p "$work" "$out"

if [ ! -d "$work/choc" ]; then
  git clone --depth 1 --branch "$CHOCOLATE_TAG" https://github.com/chocolate-doom/chocolate-doom.git "$work/choc"
  git -C "$work/choc" apply "$here/patches/speed.patch"
fi
cp "$here/bridge.c" "$work/choc/src/doom/i_bridge.c"

if [ ! -f "$work/freedoom1.wad" ]; then
  curl -sL -o "$work/freedoom.zip" "$FREEDOOM_URL"
  unzip -oj "$work/freedoom.zip" freedoom-0.13.0/freedoom1.wad -d "$work"
fi

mkdir -p "$work/cmake"
cd "$work/cmake"
emcmake cmake "$work/choc" -DCMAKE_BUILD_TYPE=Release -DHAVE_DECL_STRCASECMP=1 -DHAVE_DECL_STRNCASECMP=1 \
  -DENABLE_SDL2_MIXER=OFF -DENABLE_SDL2_NET=OFF -DCMAKE_C_FLAGS="-O2 -DHAVE_DIRENT_H" \
  -DCMAKE_EXE_LINKER_FLAGS="-sUSE_SDL=2 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web \
-sEXPORTED_FUNCTIONS=_main,_agent_ready,_agent_observe,_agent_set_controls,_agent_set_paused,_agent_set_speed \
-sEXPORTED_RUNTIME_METHODS=UTF8ToString --preload-file $work/freedoom1.wad@/freedoom1.wad \
--pre-js $here/pre.js --post-js $here/post.js"
emmake make -j8 chocolate-doom
for e in js wasm data; do cp "src/chocolate-doom.$e" "$out/doom.$e"; done
# Rename the outputs, and load doom.data next to doom.js whatever page embeds it.
perl -pi -e 's/chocolate-doom\.(wasm|data)/doom.$1/g; s|REMOTE_PACKAGE_BASE="doom.data"|REMOTE_PACKAGE_BASE=document.currentScript.src.replace(/[^/]*\$/,"")+"doom.data"|' "$out/doom.js"
ls -l "$out"
