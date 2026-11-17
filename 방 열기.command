#!/bin/sh
# macOS / Linux: double-click (macOS) or run "sh 방\ 열기.command"
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Get it from https://nodejs.org"; read -r _; exit 1; fi
node serve.mjs --open
