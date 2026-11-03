#!/usr/bin/env bash
# 构建网页版：先产出 wasm，再打 Vite 静态资源。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

"$ROOT/scripts/build-wasm.sh"

echo "▸ npm install（首次）"
if [ ! -d apps/web/node_modules ]; then
  npm --prefix apps/web install --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}"
fi

echo "▸ vite build"
npm --prefix apps/web run build

echo "▸ 产物 apps/web/dist"
