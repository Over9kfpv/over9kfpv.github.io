#!/usr/bin/env bash
# Prepare one track project: scaffold, copy audio, align lyrics, analyze beats.
# Usage: prep.sh <track-number>
set -euo pipefail
ALBUM="$(cd "$(dirname "$0")/../.." && pwd)"
N=$1; NN=$(printf %02d "$N")
SRC=$(ls "$ALBUM"/audio/"$NN"-*.mp3); NAME=$(basename "$SRC" .mp3); SLUG=${NAME#??-}
P="$ALBUM/videos/$NAME"
LYR=$(ls "$ALBUM"/_source/"$SLUG ["*"(lyrics).txt")
if [ ! -f "$P/hyperframes.json" ]; then
  mkdir -p "$P"
  cp "$ALBUM/videos/01-tiny-whoop/"{hyperframes.json,package.json,meta.json,CLAUDE.md,AGENTS.md} "$P/"
  sed -i "s/01-tiny-whoop/$NAME/g" "$P/package.json" "$P/meta.json"
fi
mkdir -p "$P/assets" "$P/renders"
cp "$SRC" "$P/assets/bgm.mp3"
[ -f "$P/lyrics.json" ] || "$ALBUM/videos/_tools/align.sh" "$SRC" "$LYR" -o "$P/lyrics.json" 2>&1 | grep -E "lines,|Error" || true
[ -f "$P/audiomap.json" ] || ~/.venvs/lyricsync/bin/python "$ALBUM/.claude/skills/music-to-video/scripts/analyze-beatgrid.py" "$P/assets/bgm.mp3" -o "$P/audiomap.json" >/dev/null
echo "prepped $NAME"
