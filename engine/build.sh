#!/usr/bin/env bash
# Rebuilds public/engine/doom.{js,wasm,data} and the test-only tests/debug-engine/doom.{js,wasm}.
# Needs emsdk 3.1.74 (emcc, emcmake), cmake, perl, curl, unzip. Output is committed, so deployers never need this.
set -euo pipefail

EMSCRIPTEN_VERSION=3.1.74
CHOCOLATE_COMMIT=410d96855b5df5410ff591a90efeafa889119224 # tag chocolate-doom-3.1.1
SOURCE_SHA256=1ec7a89a5fb57c9bb187e4ba543e71824dc8771fe7046842f57ea6b98201ef2e
FREEDOOM_URL=https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
FREEDOOM_ZIP_SHA256=3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59
FREEDOOM_WAD_SHA256=7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d

here=$(cd "$(dirname "$0")" && pwd)
root=$here/..
work=${DOOM_BUILD_DIR:-$here/.build}
mkdir -p "$work"

check() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ] || { echo "checksum mismatch: $1" >&2; exit 1; }; }

emcc --version | head -1 | grep -q "[( ]$EMSCRIPTEN_VERSION " || { echo "need emsdk $EMSCRIPTEN_VERSION" >&2; exit 1; }

tarball=$here/source/chocolate-doom-3.1.1.tar.gz
check "$tarball" "$SOURCE_SHA256"
[ "$(gzip -dc "$tarball" | git get-tar-commit-id)" = "$CHOCOLATE_COMMIT" ] || { echo "source is not $CHOCOLATE_COMMIT" >&2; exit 1; }

if [ ! -f "$work/freedoom1.wad" ]; then
  curl -sfL -o "$work/freedoom.zip" "$FREEDOOM_URL"
  check "$work/freedoom.zip" "$FREEDOOM_ZIP_SHA256"
  unzip -oj "$work/freedoom.zip" freedoom-0.13.0/freedoom1.wad -d "$work"
fi
check "$work/freedoom1.wad" "$FREEDOOM_WAD_SHA256"

# build <name> <out dir> <extra cflags> <extra exports> <data path written into doom.js>
build() {
  local dir; dir=$(mktemp -d "$work/$1.XXXXXX") # fresh tree every time, so the patch always applies to pristine source
  tar -xzf "$tarball" -C "$dir" --strip-components=1
  patch -p1 -s --fuzz=0 -d "$dir" < "$here/patches/speed.patch"
  cp "$here/bridge.c" "$dir/src/doom/i_bridge.c"
  mkdir "$dir/_build"
  cd "$dir/_build"
  emcmake cmake "$dir" -DCMAKE_BUILD_TYPE=Release -DHAVE_DECL_STRCASECMP=1 -DHAVE_DECL_STRNCASECMP=1 \
    -DENABLE_SDL2_MIXER=OFF -DENABLE_SDL2_NET=OFF -DCMAKE_C_FLAGS="-O2 -DHAVE_DIRENT_H $3" \
    -DCMAKE_EXE_LINKER_FLAGS="-sUSE_SDL=2 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web \
-sEXPORTED_FUNCTIONS=_main,_agent_ready,_agent_observe,_agent_set_controls,_agent_set_paused,_agent_set_speed$4 \
-sEXPORTED_RUNTIME_METHODS=UTF8ToString --preload-file $work/freedoom1.wad@/freedoom1.wad \
--pre-js $here/pre.js --post-js $here/post.js" > /dev/null
  emmake make -j8 chocolate-doom > /dev/null
  mkdir -p "$2"
  cp src/chocolate-doom.js "$2/doom.js"
  cp src/chocolate-doom.wasm "$2/doom.wasm"
  [ -z "${6:-}" ] || cp src/chocolate-doom.data "$2/doom.data"
  # Rename the outputs, and load doom.data next to doom.js (or at $5) whatever page embeds it.
  DATA=$5 perl -pi -e 's/chocolate-doom\.(wasm|data)/doom.$1/g; s|REMOTE_PACKAGE_BASE="doom.data"|REMOTE_PACKAGE_BASE=document.currentScript.src.replace(/[^/]*\$/,"")+"$ENV{DATA}"|' "$2/doom.js"
  cd "$here"
}

build prod "$root/public/engine" "" "" doom.data keep-data
build debug "$root/tests/debug-engine" "-DAGENT_DEBUG" ",_agent_debug_spawn,_agent_debug_enable_input" ../../public/engine/doom.data
ls -l "$root/public/engine" "$root/tests/debug-engine"
