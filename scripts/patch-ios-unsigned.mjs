import fs from 'node:fs';
const file = 'src-tauri/gen/apple/project.yml';
let text = fs.readFileSync(file, 'utf8');
if (!text.includes('CODE_SIGNING_ALLOWED')) {
  text = text.replace(
    '      base:',
    '      base:
        CODE_SIGNING_ALLOWED: "NO"
        CODE_SIGNING_REQUIRED: "NO"
        CODE_SIGN_IDENTITY: ""'
  );
  fs.writeFileSync(file, text, 'utf8');
  console.log('Patched src-tauri/gen/apple/project.yml for unsigned iOS build.');
}
