#!/usr/bin/env bash
# Runs align_lyrics.py in the lyricsync venv with the CUDA 12 libs faster-whisper needs.
V=~/.venvs/lyricsync
SP=$($V/bin/python -c "import site;print(site.getsitepackages()[0])")
export LD_LIBRARY_PATH="$SP/nvidia/cublas/lib:$SP/nvidia/cudnn/lib:${LD_LIBRARY_PATH}"
exec $V/bin/python "$(dirname "$0")/align_lyrics.py" "$@"
