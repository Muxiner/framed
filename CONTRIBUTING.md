# Contributing

感谢使用和参与框影 Framed。

## 开发

```bash
# 依赖 Rust stable + wasm32 target + Node 22
rustup target add wasm32-unknown-unknown
./scripts/build-wasm.sh
npm --prefix apps/web install
npm --prefix apps/desktop install

npm --prefix apps/web run dev            # 网页
npm --prefix apps/desktop run tauri dev  # 桌面
```

## 提交前检查

```bash
cargo fmt --all -- --check
cargo clippy -p framed-core -p framed-cli -p framed-wasm --all-targets -- -D warnings
cargo test -p framed-core
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

## 发布

发布由 [`.github/workflows/release.yml`](.github/workflows/release.yml) 自动完成：

1. `node scripts/set-version.mjs X.Y.Z`
2. 提交并创建 tag：`git tag vX.Y.Z`
3. `git push origin main && git push origin vX.Y.Z`
4. Actions 构建 macOS universal dmg + Windows NSIS exe，上传到 GitHub Release

## 许可

贡献的代码以 MIT 许可发布；内嵌字体遵循各自 OFL 许可。
