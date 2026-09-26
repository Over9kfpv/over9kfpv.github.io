#!/usr/bin/env bash
# Lyric videos for the streamstart bench music: every mp3 in mp3/bench gets a transparent
# "<name>.webm" subtitle overlay beside it. Tracks with a "(lyrics).txt" show the lyrics;
# tracks without one are instrumentals and show a beat-driven equalizer instead.
# Usage: bench.sh [prep|build|render|all] [sung|instrumental]   (default: all, both)
set -euo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ALBUM_PROJ="$TOOLS/../01-tiny-whoop"
SRC=/home/hans/Projects/streamstart/mp3/bench
WORK=/home/hans/Projects/streamstart/videos/bench-lyrics
ART="$WORK/_shared/art.png"
STEP=${1:-all}
ONLY=${2:-}

# process <mp3> <lyrics.txt or ""> <subtitle>
process() {
  local MP3=$1 LYR=$2 SUB=$3
  local STEM ID P
  STEM=$(basename "$MP3" .mp3)
  ID=$(grep -oE '\[[0-9a-f]{8}' <<<"$STEM" | tr -d '[')
  P="$WORK/$ID"
  if [[ $STEP == prep || $STEP == all ]]; then
    mkdir -p "$P/assets" "$P/renders"
    cp "$ALBUM_PROJ/"{hyperframes.json,package.json} "$P/"
    sed -i "s/\"01-tiny-whoop\"/\"bench-$ID\"/" "$P/package.json"
    cp "$MP3" "$P/assets/bgm.mp3"
    cat > "$P/video.json" <<EOF
{"layout": "subtitles", "title": "Screw Search", "band": "Bench Sessions",
 "subtitle": "$SUB", "art": "$ART"}
EOF
    if [ -n "$LYR" ] && [ ! -f "$P/lyrics.json" ]; then
      "$TOOLS/align.sh" "$MP3" "$LYR" -o "$P/lyrics.json" 2>&1 | grep -E "lines,|Error" | sed "s|^|$ID: |" || true
    fi
    [ -f "$P/audiomap.json" ] || ~/.venvs/lyricsync/bin/python "$TOOLS/../../.claude/skills/music-to-video/scripts/analyze-beatgrid.py" "$P/assets/bgm.mp3" -o "$P/audiomap.json" >/dev/null
  fi
  if [[ $STEP == build || $STEP == all ]]; then
    node "$TOOLS/build.mjs" "$P" | sed "s|^|$SUB: |"
  fi
  if [[ $STEP == render || $STEP == all ]]; then
    if [ -f "$SRC/$STEM.webm" ]; then echo "$ID: already rendered"; return; fi
    (cd "$P" && npx --yes hyperframes@0.8.78 render . --skill=music-to-video --format webm -q looks -o renders/video.webm --fps 30 2>&1 | grep -E "MB ·|rror" | sed "s|^|$ID: |")
    cp "$P/renders/video.webm" "$SRC/$STEM.webm"
  fi
}

# Sung tracks. Song number = order of first appearance of each distinct lyric text;
# take = A/B within it.
declare -A SONG TAKES
n=0
mapfile -t LYRS < <(ls "$SRC"/*"(lyrics).txt" | sort)
for f in "${LYRS[@]}"; do
  h=$(md5sum "$f" | cut -c1-12)
  [ -n "${SONG[$h]:-}" ] || { n=$((n + 1)); SONG[$h]=$n; }
done
for LYR in "${LYRS[@]}"; do
  [ "$ONLY" = instrumental ] && break
  MP3="${LYR% (lyrics).txt}.mp3"
  [ -f "$MP3" ] || continue
  h=$(md5sum "$LYR" | cut -c1-12)
  T=$(( ${TAKES[$h]:-0} + 1 )); TAKES[$h]=$T
  process "$MP3" "$LYR" "Song ${SONG[$h]} · Take $([ "$T" = 1 ] && echo A || echo B)"
done

# Instrumentals: mp3s with no lyrics file.
i=0
for MP3 in "$SRC"/*.mp3; do
  [ "$ONLY" = sung ] && break
  [ -f "${MP3%.mp3} (lyrics).txt" ] && continue
  i=$((i + 1))
  process "$MP3" "" "Instrumental $i"
done
