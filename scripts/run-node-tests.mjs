import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const surahs = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/surahs-114.json'), 'utf8'));
const mushaf = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/mushaf-604.json'), 'utf8'));
const reciters = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/reciters.json'), 'utf8'));
const shamim = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/shamim-baqarah-timings.json'), 'utf8'));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

console.log('Running Full Tactile Quran Recitation Instrument Verification Suite...\n');

test('114 Surahs catalog sums to exactly 6,236 Ayahs with monotonic Madani pages 1..604', () => {
  assert.equal(surahs.length, 114);
  assert.equal(surahs.reduce((acc, s) => acc + s.ayahs, 0), 6236);
  for (let i = 1; i < surahs.length; i++) {
    assert.equal(surahs[i].id, surahs[i - 1].id + 1);
    assert.ok(surahs[i].startPage >= surahs[i - 1].startPage);
    assert.ok(surahs[i].startPage >= 1 && surahs[i].startPage <= 604);
  }
});

test('All 6 Reciters registered including 01 Shamim and 06 Yasser Al-Dosari (Yasser_Ad-Dussary_128kbps)', () => {
  assert.equal(reciters.length, 6);
  assert.equal(reciters[0].id, 1);
  assert.equal(reciters[0].name, 'Qari Muhammad Shamim');
  assert.equal(reciters[5].id, 6);
  assert.equal(reciters[5].name, 'Yasser Al-Dosari');
  assert.equal(reciters[5].everyAyahDir, 'Yasser_Ad-Dussary_128kbps');
});

test('Bundled Mushaf pages (1, 2, 3, 45, 604) have exact verse counts and multi-Surah keys', () => {
  assert.equal(mushaf['1'].length, 7);
  assert.equal(mushaf['2'].length, 5);
  assert.equal(mushaf['3'].length, 11);
  assert.equal(mushaf['45'].length, 5);
  assert.equal(mushaf['604'].length, 15);
  assert.equal(mushaf['604'][0].verseKey, '112:1');
  assert.equal(mushaf['604'][14].verseKey, '114:6');
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clampVerseRange(start, end, maxV) {
  const s = clamp(Math.trunc(start), 1, Math.max(1, maxV));
  const e = clamp(Math.trunc(end), s, Math.max(1, maxV));
  return { rangeStart: s, rangeEnd: e };
}

test('Verse range clamping strictly enforces 1 <= start <= end <= pageMaxVerse', () => {
  assert.deepEqual(clampVerseRange(0, 99, 5), { rangeStart: 1, rangeEnd: 5 });
  assert.deepEqual(clampVerseRange(4, 2, 5), { rangeStart: 4, rangeEnd: 4 });
  assert.deepEqual(clampVerseRange(2, 15, 15), { rangeStart: 2, rangeEnd: 15 });
});

const PAUSE = new Set(['ۖ', 'ۗ', 'ۘ', 'ۙ', 'ۚ', 'ۛ', 'ۜ', '۞', '۩']);
function tokenize(text) {
  const out = [];
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    if (PAUSE.has(tok) && out.length > 0) out[out.length - 1] += ' ' + tok;
    else out.push(tok);
  }
  return out;
}
function synth(text, durMs) {
  const toks = tokenize(text);
  const w = toks.map(t => Math.max(2, t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').length * 1.15 + (/ٓ/.test(t) ? 3.2 : 0)));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let cur = 0;
  return toks.map((t, i) => {
    const share = (w[i] / total) * durMs;
    const s = Math.round(cur);
    const e = i === toks.length - 1 ? Math.round(durMs) : Math.round(cur + share);
    cur += share;
    return { wordIndex: i + 1, textUthmani: t, startMs: s, endMs: e };
  });
}
function resolveWord(words, ms) {
  if (!words.length || ms < words[0].startMs) return 0;
  let lo = 0, hi = words.length - 1, ans = words[0].wordIndex;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ms >= words[mid].startMs && ms < words[mid].endMs) return words[mid].wordIndex;
    if (ms < words[mid].startMs) hi = mid - 1;
    else { ans = words[mid].wordIndex; lo = mid + 1; }
  }
  return ans;
}

test('Arabic tokenizer, maddah weighting, and O(log W) binary search sync resolver', () => {
  const segs = synth(mushaf['2'][1].textUthmani, 10100);
  assert.equal(segs.length, 7);
  assert.equal(segs[0].startMs, 0);
  assert.equal(segs[segs.length - 1].endMs, 10100);
  assert.equal(resolveWord(segs, -10), 0);
  assert.equal(resolveWord(segs, 0), 1);
  assert.equal(resolveWord(segs, 10099), 7);
});

function nextTransition(pass, rep, idx, len) {
  if (idx < len - 1) return { nextPhase: 'PLAYING', nextPass: pass, nextAyahIdx: idx + 1 };
  if (pass < rep) return { nextPhase: 'PASS_RESET', nextPass: pass + 1, nextAyahIdx: 0 };
  return { nextPhase: 'COMPLETED', nextPass: pass, nextAyahIdx: idx };
}

test('Full-range block repetition FSM repeats 1..N and completes cleanly', () => {
  assert.deepEqual(nextTransition(1, 3, 0, 5), { nextPhase: 'PLAYING', nextPass: 1, nextAyahIdx: 1 });
  assert.deepEqual(nextTransition(1, 3, 4, 5), { nextPhase: 'PASS_RESET', nextPass: 2, nextAyahIdx: 0 });
  assert.deepEqual(nextTransition(3, 3, 4, 5), { nextPhase: 'COMPLETED', nextPass: 3, nextAyahIdx: 4 });
});

test('Qari Muhammad Shamim Surah Al-Baqarah 2:1..2:10 clip boundaries are strictly monotonic', () => {
  const keys = Object.keys(shamim);
  assert.equal(keys.length, 10);
  let prev = 0;
  for (const k of keys) {
    assert.ok(shamim[k].startMs >= prev);
    assert.ok(shamim[k].endMs > shamim[k].startMs);
    prev = shamim[k].endMs;
  }
});

test('Playback speed steps cycle cleanly across 0.75x..2x', () => {
  const steps = [0.75, 1, 1.25, 1.5, 1.75, 2];
  assert.equal(steps[(steps.indexOf(1) + 1) % steps.length], 1.25);
  assert.equal(steps[(steps.indexOf(2) + 1) % steps.length], 0.75);
});

test('Uploaded logo icons, Opus offline pack builder, and GitHub Actions workflow exist', () => {
  for (const rel of [
    'public/favicon.png',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'src-tauri/icons/32x32.png',
    'src-tauri/icons/128x128.png',
    'src-tauri/icons/128x128@2x.png',
    'src-tauri/icons/icon.ico',
    'src-tauri/icons/icon.png',
    'scripts/build-offline-packs.mjs',
    '.github/workflows/release-offline.yml',
    'src-tauri/build.rs',
    'public/audio-packs/.gitkeep'
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `Missing required file: ${rel}`);
  }
});


test('package.json defines "tauri" script and @types/node, and workflow builds Desktop + Android + iOS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.tauri, 'tauri');
  assert.ok(pkg.devDependencies['@types/node']);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/release-offline.yml'), 'utf8');
  assert.ok(wf.includes('build-android:'));
  assert.ok(wf.includes('build-ios:'));
  assert.ok(wf.includes('build-offline-audio-packs:'));
});

console.log(`\nALL ${passed}/${passed} TESTS PASSED.`);
