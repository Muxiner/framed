#!/usr/bin/env bash
# 框影 Framed · 桌面构建脚本（macOS 本地 / CI 通用）
#
#   1) 构建网页静态产物 apps/web/dist（Tauri 的 frontendDist 指向它）
#   2) tauri build 产出 apps/desktop/src-tauri/target/release/bundle/macos/Framed.app
#
# 本机沙箱说明（在受限环境里构建时需要）：
#   - ~/.cargo 可能不可写，需要把 CARGO_HOME 指到可写目录后再执行，例如：
#       export CARGO_HOME=/Users/muxiner/Documents/Development/.dsh-tools/cargo-home
#   - npm 缓存同理，可用：
#       export npm_config_cache=/Users/muxiner/Documents/Development/.dsh-tools/npm-cache
#       export npm_config_registry=https://registry.npmmirror.com
#   - 本脚本不会覆盖这两个变量，只沿用当前 shell 的环境。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/desktop"
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle/macos"

echo "==> [1/2] 构建网页静态产物（apps/web/dist）"
npm --prefix "$ROOT/apps/web" run build

if [ ! -f "$ROOT/apps/web/dist/index.html" ]; then
  echo "!! apps/web/dist/index.html 不存在，Tauri 无法打包前端" >&2
  exit 1
fi

echo "==> [2/2] 构建 Tauri 桌面应用（release）"
npm --prefix "$APP_DIR" run tauri build

echo
echo "==> 完成。应用产物："
ls -la "$BUNDLE_DIR"/*.app 2>/dev/null || {
  echo "!! 未找到 $BUNDLE_DIR/Framed.app" >&2
  exit 1
}
echo
echo "启动：open \"$BUNDLE_DIR/Framed.app\""
