#!/usr/bin/env bash
# WSL2 から Windows の既定アプリで PDF を開く
f="${1:-out/2026-07-19.pdf}"
explorer.exe "$(wslpath -w "$f")" 2>/dev/null || cmd.exe /c start "" "$(wslpath -w "$f")"
