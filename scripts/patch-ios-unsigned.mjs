import fs from 'node:fs';
const file = 'src-tauri/gen/apple/project.yml';
let text = fs.readFileSync(file, 'utf8');
if (!text.includes('CODE_SIGNING_ALLOWED')) {
  text = text.replace(
    '      base:',
    '      base:\n        CODE_SIGNING_ALLOWED: "NO"\n        CODE_SIGNING_REQUIRED: "NO"\n        CODE_SIGN_IDENTITY: ""'
  );
  fs.writeFileSync(file, text, 'utf8');
  console.log('Patched project.yml for unsigned iOS build.');
}
