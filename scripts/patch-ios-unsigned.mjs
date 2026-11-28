import fs from 'node:fs';

const file = 'src-tauri/gen/apple/project.yml';
if (!fs.existsSync(file)) {
  console.log('project.yml not found; skipping iOS unsigned patch.');
  process.exit(0);
}

let text = fs.readFileSync(file, 'utf8');
text = text.replace(/^\s*DEVELOPMENT_TEAM:.*$/gm, '');
if (!text.includes('CODE_SIGNING_ALLOWED: NO')) {
  const snippet = [
    '      base:',
    '        CODE_SIGNING_ALLOWED: NO',
    '        CODE_SIGNING_REQUIRED: NO',
    '        CODE_SIGN_IDENTITY: ""'
  ].join('\n');
  text = text.replace(/settings:\s*\n\s*base:/, 'settings:\n' + snippet);
}
fs.writeFileSync(file, text);
console.log('Patched src-tauri/gen/apple/project.yml for unsigned CI build.');
