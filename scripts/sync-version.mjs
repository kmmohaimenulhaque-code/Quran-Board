import fs from 'node:fs';

const raw = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const version = raw.replace(/^v/, '').trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.log(`Skipping version sync (non-semver ref: "${raw}")`);
  process.exit(0);
}

for (const file of ['package.json', 'src-tauri/tauri.conf.json']) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  obj.version = version;
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '
', 'utf8');
}

const cargoPath = 'src-tauri/Cargo.toml';
const cargo = fs.readFileSync(cargoPath, 'utf8').replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo, 'utf8');
console.log(`Synced package.json, tauri.conf.json, and Cargo.toml -> v${version}`);
