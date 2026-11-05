#!/usr/bin/env node
// 把版本号同步到 Rust / npm / Tauri 清单；发布 workflow 会用 git tag 调用。
// 用法：node scripts/set-version.mjs 0.3.0
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法：node scripts/set-version.mjs <semver>，例如 0.3.0');
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const changed = [];

function updateJson(relative) {
  const file = path.join(root, relative);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.version === version) return;
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  changed.push(relative);
}

function updateCargo(relative) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  let inWorkspace = false;
  let updated = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '[workspace.package]') {
      inWorkspace = true;
      continue;
    }
    if (inWorkspace && line.trim().startsWith('[')) break;
    if (inWorkspace && line.startsWith('version = ')) {
      lines[index] = `version = "${version}"`;
      updated = true;
      break;
    }
  }
  if (!updated) {
    // 独立 cargo 工程（apps/desktop/src-tauri）：替换 [package] 下的 version
    let inPackage = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '[package]') {
        inPackage = true;
        continue;
      }
      if (inPackage && line.trim().startsWith('[')) break;
      if (inPackage && line.startsWith('version = ')) {
        lines[index] = `version = "${version}"`;
        updated = true;
        break;
      }
    }
  }
  if (!updated) throw new Error(`${relative} 未找到 version`);
  fs.writeFileSync(file, lines.join('\n'));
  changed.push(relative);
}

updateCargo('Cargo.toml');
updateCargo('apps/desktop/src-tauri/Cargo.toml');
updateJson('apps/web/package.json');
updateJson('apps/desktop/package.json');
updateJson('apps/desktop/src-tauri/tauri.conf.json');

if (changed.length === 0) {
  console.log(`版本已经是 ${version}`);
} else {
  console.log(`版本 → ${version}`);
  for (const file of changed) console.log(`  ${file}`);
}
