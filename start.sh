#!/usr/bin/env bash
# 一键启动本地预览
set -e
PORT="${PORT:-8000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 杀掉占用端口的旧进程
if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Killing existing process on port $PORT..."
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
fi

echo "Starting NPC collector on http://localhost:$PORT"
open "http://localhost:$PORT" 2>/dev/null || true
python3 -m http.server "$PORT"
