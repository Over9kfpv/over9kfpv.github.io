#!/usr/bin/env bash
# Lyric videos for the streamstart bench music: every mp3 in mp3/bench that has a
# "(lyrics).txt" next to it gets a transparent "<name>.webm" lyric overlay beside it. Instrumentals are skipped.
# Usage: bench.sh [prep|build|render|all]   (default: all)
set -euo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ALBUM_PROJ="$TOOLS/../01-tiny-whoop"
SRC=/home/hans/Projects/streamstart/mp3/bench
WORK=/home/hans/Projects/streamstart/videos/bench-lyrics
ART="$WORK/_shared/art.png"
STEP=${1:-all}

# Song number = order of first appearance of each distinct lyric text; take = A/B within it.
declare -A SONG TAKES
n=0
mapfile -t LYRS < <(ls "$SRC"/*"(lyrics).txt" | sort)
for f in "${LYRS[@]}"; do
  h=$(md5sum "$f" | cut -c1-12)
  [ -n "${SONG[$h]:-}" ] || { n=$((n + 1)); SONG[$h]=$n; }
done

for LYR in "${LYRS[@]}"; do
  MP3="${LYR% (lyrics).txt}.mp3"
  [ -f "$MP3" ] || continue
  STEM=$(basename "$MP3" .mp3)
  ID=$(grep -oE '\[[0-9a-f]{8}' <<<"$STEM" | tr -d '[')
  h=$(md5sum "$LYR" | cut -c1-12)
  S=${SONG[$h]}; T=$(( ${TAKES[$h]:-0} + 1 )); TAKES[$h]=$T
  TAKE=$([ "$T" = 1 ] && echo A || echo B)
  P="$WORK/$ID"
  if [[ $STEP == prep || $STEP == all ]]; then
    mkdir -p "$P/assets" "$P/renders"
    cp "$ALBUM_PROJ/"{hyperframes.json,package.json} "$P/"
    sed -i "s/\"01-tiny-whoop\"/\"bench-$ID\"/" "$P/package.json"
    cp "$MP3" "$P/assets/bgm.mp3"
    cat > "$P/video.json" <<EOF
{"layout": "subtitles", "title": "Screw Search", "band": "Bench Sessions",
 "subtitle": "Song $S · Take $TAKE", "art": "$ART"}
EOF
    [ -f "$P/lyrics.json" ] || "$TOOLS/align.sh" "$MP3" "$LYR" -o "$P/lyrics.json" 2>&1 | grep -E "lines,|Error" | sed "s|^|$ID: |" || true
    [ -f "$P/audiomap.json" ] || ~/.venvs/lyricsync/bin/python "$TOOLS/../../.claude/skills/music-to-video/scripts/analyze-beatgrid.py" "$P/assets/bgm.mp3" -o "$P/audiomap.json" >/dev/null
  fi
  if [[ $STEP == build || $STEP == all ]]; then
    node "$TOOLS/build.mjs" "$P" | sed "s|^|song $S$TAKE |"
  fi
  if [[ $STEP == render || $STEP == all ]]; then
    (cd "$P" && npx --yes hyperframes@0.8.78 render . --skill=music-to-video --format webm -q looks -o renders/video.webm --fps 30 2>&1 | grep -E "MB ·|rror" | sed "s|^|$ID: |")
    cp "$P/renders/video.webm" "$SRC/$STEM.webm"
  fi
done
