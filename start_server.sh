#!/usr/bin/env bash
set -euo pipefail

cd /Users/daiko/.openclaw/workspace/sami-news-board
exec /usr/bin/python3 -m http.server 8787 --bind 0.0.0.0
