#!/usr/bin/env bash
# 构建 WebAssembly 内核，并放到网页端静态目录。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "▸ cargo build -p framed-wasm (wasm32-unknown-unknown)"
cargo build -p framed-wasm --target wasm32-unknown-unknown --release

mkdir -p apps/web/public
cp target/wasm32-unknown-unknown/release/framed_wasm.wasm apps/web/public/framed_wasm.wasm

SIZE=$(du -h apps/web/public/framed_wasm.wasm | cut -f1)
echo "▸ apps/web/public/framed_wasm.wasm (${SIZE})"
