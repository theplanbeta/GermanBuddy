#!/bin/bash
# Runs ON the Colab machine. Sets up Fish Audio S2-Pro beside Colab's own Python, not inside it:
# the maker pins Python 3.12, torch 2.8.0 and transformers 5.19.0 (pyproject.toml), Colab ships
# Python 3.13 and torch 2.14, so `uv sync` builds a separate environment in /content/fish-speech/.venv.
# Nothing here touches the Mac. The model (11 GB) is downloaded onto the Colab machine only.
# Licence of code and weights: Fish Audio Research License, non-commercial use only.
set -e
t() { echo "STEP $1 $(date +%s)"; }
cd /content
t apt;   apt-get install -y -qq portaudio19-dev libsox-dev ffmpeg >/dev/null
t clone; [ -d fish-speech ] || git clone -q --depth 1 https://github.com/fishaudio/fish-speech.git
cd fish-speech; git rev-parse HEAD
t sync;  uv sync -q --python 3.12 --extra cu129
t client; uv pip install --system -q ormsgpack soundfile
t weights
python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("fishaudio/s2-pro", local_dir="checkpoints/s2-pro", ignore_patterns=["*.png"])
EOF
t done; du -sh checkpoints/s2-pro .venv
