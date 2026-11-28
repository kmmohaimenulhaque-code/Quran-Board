import fs from 'node:fs';
import path from 'node:path';

const rawTag = process.env.GITHUB_REF_NAME || process.argv[2] || '';
const match = rawTag.match(/(\d+\.\d+\.\d+)/);
const version = match ? match[1] : JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

console.log(`Syncing app version to ${version} (from ref: ${rawTag || 'package.json'})`);

function updateJson(file, updater) {
  if (!fs.existsSync(file)) return;
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  updater(obj);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  console.log(`Updated ${file} -> ${version}`);
}

updateJson('package.json', (o) => { o.version = version; });
updateJson('src-tauri/tauri.conf.json', (o) => { o.version = version; });

const cargoPath = path.join('src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(cargoPath, cargo);
  console.log(`Updated ${cargoPath} -> ${version}`);
}
