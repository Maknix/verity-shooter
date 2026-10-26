#!/usr/bin/env sh
# Serves the game at http://localhost:8000  (needs Python 3 - no Node.js)
cd "$(dirname "$0")"
echo "Verity Shooter -> http://localhost:8000"
python3 -m http.server 8000 || python -m http.server 8000
