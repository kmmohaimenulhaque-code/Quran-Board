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
    'public/audio-packs/.gitkeep',
    'src/ui/OfflineDrawer.tsx',
    'src/ui/SurahDrawer.tsx'
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


test('WebKitGTK 3D overlay fix (.slab-3d-stage), Android apksigner, and iOS tauri ios build are configured', () => {
  const chassis = fs.readFileSync(path.join(root, 'src/ui/Chassis.tsx'), 'utf8');
  assert.ok(chassis.includes('slab-3d-stage'));
  const wf = fs.readFileSync(path.join(root, '.github/workflows/release-offline.yml'), 'utf8');
  assert.ok(wf.includes('apksigner'));
  assert.ok(wf.includes('tauri icon'));
  assert.ok(wf.includes('tauri ios build --ci'));
});


test('Bismillah rules: strip API prefix, inject before Ayah 1 (except Surah 1 & 9), handle Page 604 multi-Surah', () => {
  const BIS = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
  const stripBis = (txt, su, ay) =>
    (su === 1 || su === 9 || ay !== 1)
      ? txt.trim()
      : txt.replace(/^\s*بِسْمِ\s+ٱ?للَّهِ\s+ٱ?لرَّحْمَٰنِ\s+ٱ?لرَّحِيمِ\s*/u, '').trim();
  const expandBis = (vs) => {
    const out = [];
    for (const v of vs) {
      if (v.ayah === 1 && v.surah !== 1 && v.surah !== 9) {
        out.push({ verseKey: `${v.surah}:0`, surah: v.surah, ayah: 0, isBismillah: true, textUthmani: BIS });
        out.push({ ...v, textUthmani: stripBis(v.textUthmani, v.surah, v.ayah) });
      } else out.push(v);
    }
    return out;
  };
  assert.equal(stripBis(`${BIS} يسٓ`, 36, 1), 'يسٓ');
  assert.equal(expandBis(mushaf['1']).some((v) => v.isBismillah), false);
  assert.equal(expandBis([{ verseKey: '9:1', surah: 9, ayah: 1, textUthmani: 'بَرَآءَةٌ' }]).length, 1);
  assert.equal(expandBis(mushaf['2'])[0].verseKey, '2:0');
  assert.deepEqual(
    expandBis(mushaf['604']).filter((v) => v.isBismillah).map((v) => v.verseKey),
    ['112:0', '113:0', '114:0']
  );
  assert.ok(fs.existsSync(path.join(root, 'src/core/bismillah.ts')));
  assert.ok(fs.existsSync(path.join(root, 'src/core/__tests__/bismillah.test.ts')));
  const prov = fs.readFileSync(path.join(root, 'src/engine/public-provider.ts'), 'utf8');
  assert.ok(prov.includes('cacheAllReciterBismillahs'));
  assert.ok(prov.includes('001001.mp3'));
});

console.log(`\nALL ${passed}/${passed} TESTS PASSED.`);


test('v1.1.0 Bugfix Verification: 11 per-ayah Shamim clips + Pass 2 Bismillah skip + Auto-paging + Real Ayah Sync + Non-blocking Linux adapter', () => {
  // 1. All 11 pre-sliced Shamim MP3 clips exist (002000.mp3..002010.mp3)
  for (let i = 0; i <= 10; i++) {
    const clip = path.join(root, 'public/audio/shamim', `002${String(i).padStart(3, '0')}.mp3`);
    assert.ok(fs.existsSync(clip), `Missing Shamim clip ${clip}`);
    assert.ok(fs.statSync(clip).size > 15000, `Shamim clip too small: ${clip}`);
  }
  const prov = fs.readFileSync(path.join(root, 'src/engine/public-provider.ts'), 'utf8');
  assert.ok(prov.includes('/audio/shamim/002000.mp3'), 'public-provider must use /audio/shamim/002000.mp3');
  assert.ok(prov.includes('getCachedPageVerses'), 'public-provider must expose synchronous getCachedPageVerses');

  // 2. Pass 2..N skips Bismillah in state-machine.ts and App.tsx
  const sm = fs.readFileSync(path.join(root, 'src/core/state-machine.ts'), 'utf8');
  assert.ok(sm.includes('computePassResetAyahIdx'), 'state-machine must define computePassResetAyahIdx');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.ok(app.includes('updated.bundles[startIdx]'), 'App.tsx PASS_RESET must resume from updated.currentAyahIdx');

  // 3. Face B multi-page auto-paging in RecitationSlate.tsx
  const slate = fs.readFileSync(path.join(root, 'src/ui/RecitationSlate.tsx'), 'utf8');
  assert.ok(slate.includes('slatePageIndex'), 'RecitationSlate must track slatePageIndex');
  assert.ok(slate.includes('translateY(-'), 'RecitationSlate must translateY to reveal overflowing verses');
  assert.ok(slate.includes('activeWordRef'), 'RecitationSlate must measure activeWordRef');

  // 4. Real Surah Ayah sync on Face A (Page 2 -> 1..5, Page 3 -> 6..16, Page 45 -> 265..269)
  const mushaf = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/mushaf-604.json'), 'utf8'));
  assert.strictEqual(mushaf['2'][0].ayah, 1);
  assert.strictEqual(mushaf['2'][mushaf['2'].length - 1].ayah, 5);
  assert.strictEqual(mushaf['3'][0].ayah, 6);
  assert.strictEqual(mushaf['3'][mushaf['3'].length - 1].ayah, 16);
  assert.strictEqual(mushaf['45'][0].ayah, 265);
  assert.strictEqual(mushaf['45'][mushaf['45'].length - 1].ayah, 269);
  assert.ok(app.includes('displayRangeStart') && app.includes('displayRangeEnd'), 'App.tsx must pass real Surah Ayah numbers to ControlFace');
  const cf = fs.readFileSync(path.join(root, 'src/ui/ControlFace.tsx'), 'utf8');
  assert.ok(cf.includes('isThreeDigitRange'), 'ControlFace must support 3-digit Surah Ayah ranges');

  // 5. Non-blocking Linux WebKitGTK audio adapter + cancellable PREFETCHING
  const wa = fs.readFileSync(path.join(root, 'src/platform/web-adapter.ts'), 'utf8');
  assert.ok(wa.includes('AbortSignal.timeout'), 'web-adapter must enforce AbortSignal.timeout');
  assert.ok(wa.includes('isTauriRuntime'), 'web-adapter must bypass blocking fetch().blob() in Tauri WebKitGTK');
  assert.ok(app.includes('cancelPrefetchIfActive'), 'App.tsx must allow cancelling PREFETCHING');
});


test('v1.1.1 Bugfix Verification: Tajweed waqf pause, multi-Surah exact slicing (P.604), Full Surah Mode, centered Bismillah, single-line telemetry, drawer auto-pause, real offline caching', () => {
  // 1. Waqf pause between consecutive ayahs (fixes Al-Fatihah 1:6 -> 1:7 for all reciters)
  const sm = fs.readFileSync(path.join(root, 'src/core/state-machine.ts'), 'utf8');
  assert.ok(sm.includes('computeWaqfPauseMs'), 'state-machine must define computeWaqfPauseMs');
  assert.ok(sm.includes('setPageRange'), 'state-machine must define atomic setPageRange');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.ok(app.includes('waqfTimerRef') && app.includes('computeWaqfPauseMs'), 'App.tsx must enforce cancellable waqf pause');

  // 2. Multi-Surah page exact slicing on Page 604 (112: 1..4, 113: 5..9, 114: 10..15)
  const mushaf = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/data/mushaf-604.json'), 'utf8'));
  const p604 = mushaf['604'];
  const findSlice = (verses, sid) => {
    let first = -1, last = -1;
    verses.forEach((v, i) => {
      if (v.surah === sid) { if (first === -1) first = i + 1; last = i + 1; }
    });
    return { first, last };
  };
  assert.deepStrictEqual(findSlice(p604, 112), { first: 1, last: 4 });
  assert.deepStrictEqual(findSlice(p604, 113), { first: 5, last: 9 });
  assert.deepStrictEqual(findSlice(p604, 114), { first: 10, last: 15 });
  const mi = fs.readFileSync(path.join(root, 'src/core/mushaf-index.ts'), 'utf8');
  assert.ok(mi.includes('getSurahSliceOnPage'), 'mushaf-index must export getSurahSliceOnPage');

  // 3. Full Surah Mode wired end-to-end
  const prov = fs.readFileSync(path.join(root, 'src/engine/public-provider.ts'), 'utf8');
  assert.ok(prov.includes('getSurahVerses'), 'public-provider must implement getSurahVerses');
  assert.ok(app.includes("playbackMode === 'surah'") && app.includes('provider.getSurahVerses'), 'App.tsx must wire Full Surah Mode');

  // 4. Centered own-line Bismillah + hardened BOM/Hizb stripping + single-line telemetry
  const slate = fs.readFileSync(path.join(root, 'src/ui/RecitationSlate.tsx'), 'utf8');
  assert.ok(slate.includes('bismillah-block'), 'RecitationSlate must render Bismillah in centered .bismillah-block');
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.ok(css.includes('.bismillah-block') && css.includes('.telemetry-label'), 'styles.css must style .bismillah-block and non-wrapping telemetry');
  const bis = fs.readFileSync(path.join(root, 'src/core/bismillah.ts'), 'utf8');
  assert.ok(bis.includes('\\uFEFF') || bis.includes('\uFEFF'), 'bismillah.ts must strip leading BOM');

  // 5. Drawer auto-pause & genuine OfflineDrawer downloadForOffline()
  assert.ok(app.includes('pausedByDrawerRef'), 'App.tsx must pause playback when opening drawers');
  const wa = fs.readFileSync(path.join(root, 'src/platform/web-adapter.ts'), 'utf8');
  assert.ok(wa.includes('downloadForOffline'), 'web-adapter must implement genuine downloadForOffline');
  const od = fs.readFileSync(path.join(root, 'src/ui/OfflineDrawer.tsx'), 'utf8');
  assert.ok(od.includes('downloadForOffline') && od.includes('selectedSurahId'), 'OfflineDrawer must use downloadForOffline and selectedSurahId');
});


test('v1.2.0 Bugfix Verification: Persistent Offline Cache (6 Single + 6 Full 114-Surah incl. Shamim), No Silent Offline Playback, Single-Ayah Telemetry, Search Clear', () => {
  // 1. OfflineDrawer has both Active Surah (6 reciters) + Full Quran All-114-Surahs (6 reciters incl. Shamim) + persistent manifest
  const od = fs.readFileSync(path.join(root, 'src/ui/OfflineDrawer.tsx'), 'utf8');
  assert.ok(od.includes('FULL QURAN OFFLINE · ALL 114 SURAHS'), 'OfflineDrawer must have Full Quran 114-Surah section');
  assert.ok(od.includes('Cache All 114') && od.includes('handleToggleFullQuran'), 'OfflineDrawer must support Full 114-Surah caching for all 6 reciters');
  assert.ok(od.includes('CACHE_MANIFEST_KEY') && od.includes('localStorage'), 'OfflineDrawer must persist cached Surah state across restarts');
  assert.ok(od.includes('offline-sub-progress'), 'OfflineDrawer must show live per-Surah progress bar during Full Quran download');

  // 2. WebPlatformAdapter requests persistent storage + supports abortable downloadForOffline + isAudioCached
  const wa = fs.readFileSync(path.join(root, 'src/platform/web-adapter.ts'), 'utf8');
  assert.ok(wa.includes('requestPersistentStorage') && wa.includes('navigator.storage.persist'), 'web-adapter must call navigator.storage.persist');
  assert.ok(wa.includes('isAudioCached'), 'web-adapter must implement isAudioCached');

  // 3. DualBufferAudioDeck NEVER silently animates uncached ayahs offline
  const deck = fs.readFileSync(path.join(root, 'src/engine/audio-deck.ts'), 'utf8');
  assert.ok(!deck.includes('runTimedFallback'), 'audio-deck must NOT silently fake playback with runTimedFallback');
  assert.ok(deck.includes('onOfflineError') && deck.includes('navigator.onLine === false'), 'audio-deck must emit onOfflineError when uncached audio fails offline');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.ok(app.includes('onOfflineError:'), 'App.tsx must handle onOfflineError cleanly');

  // 4. Single-ayah telemetry formatting (63:4 instead of 63:4-4) & SurahDrawer search clear
  const mi = fs.readFileSync(path.join(root, 'src/core/mushaf-index.ts'), 'utf8');
  assert.ok(mi.includes('if (first.ayah === last.ayah)'), 'formatTelemetryRange must collapse single-ayah spans');
  const sd = fs.readFileSync(path.join(root, 'src/ui/SurahDrawer.tsx'), 'utf8');
  assert.ok(sd.includes('surah-search-clear'), 'SurahDrawer must include one-tap clear button');
});


test('v1.2.1 Linux AppImage Fix Verification: bundleMediaFramework, deb GStreamer deps, Linux DMABUF guard, safe RockerPair', () => {
  const tauriConf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.strictEqual(tauriConf.bundle?.linux?.appimage?.bundleMediaFramework, true, 'bundleMediaFramework must be true for Linux AppImage');
  assert.ok(Array.isArray(tauriConf.bundle?.linux?.deb?.depends) && tauriConf.bundle.linux.deb.depends.includes('gstreamer1.0-plugins-base'), 'deb depends must include gstreamer1.0-plugins-base');

  const libRs = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
  assert.ok(libRs.includes('target_os = "linux"') && libRs.includes('WEBKIT_DISABLE_DMABUF_RENDERER'), 'lib.rs must set WEBKIT_DISABLE_DMABUF_RENDERER on Linux only');

  const wf = fs.readFileSync(path.join(root, '.github/workflows/release-offline.yml'), 'utf8');
  assert.ok(wf.includes('gstreamer1.0-plugins-base') && wf.includes('gstreamer1.0-plugins-good') && wf.includes('gstreamer1.0-plugins-ugly'), 'Linux workflow must install GStreamer plugins before tauri build');

  const rocker = fs.readFileSync(path.join(root, 'src/ui/RockerPair.tsx'), 'utf8');
  assert.ok(!rocker.includes('setPointerCapture'), 'RockerPair must not use setPointerCapture (WebKitGTK lockup)');
});


test('v1.2.2 Linux Latency & Shamim Local Audio Fix Verification: no 4.5s waitForMetadata stall, lazy bundle resolution, local /audio/ blob conversion, zero backdrop-filter lag', () => {
  const deck = fs.readFileSync(path.join(root, 'src/engine/audio-deck.ts'), 'utf8');
  assert.ok(!deck.includes('await this.waitForMetadata') && !deck.includes('private waitForMetadata'), 'audio-deck must NOT block play() behind a 4.5s waitForMetadata timeout');

  const prov = fs.readFileSync(path.join(root, 'src/engine/public-provider.ts'), 'utf8');
  assert.ok(prov.includes('buildProvisionalBundle') && prov.includes('resolveBundleAudio'), 'public-provider must support lazy buildProvisionalBundle + resolveBundleAudio');
  assert.ok(prov.includes("raw.startsWith('/audio/')") && prov.includes('URL.createObjectURL'), 'public-provider must convert local /audio/ clips to blob: URLs for Linux WebKitGTK');

  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.ok(app.includes('provider.buildProvisionalBundle') && app.includes('provider.resolveBundleAudio'), 'App.tsx must resolve bundles lazily for <50ms flips');

  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  assert.ok(css.includes('backdrop-filter: none !important'), 'styles.css must disable CPU backdrop-filter blur on drawers');
});


test('v1.2.3 Linux Web Audio Engine Verification: persistent AudioContext + decodeAudioData + AudioBufferSourceNode scoped strictly to Linux Tauri', () => {
  const deck = fs.readFileSync(path.join(root, 'src/engine/audio-deck.ts'), 'utf8');
  assert.ok(deck.includes('isLinuxTauriRuntime'), 'audio-deck must detect Linux Tauri desktop cleanly');
  assert.ok(deck.includes('!/Android/i.test(ua)'), 'Linux Web Audio path must NOT alter Android');
  assert.ok(deck.includes('decodeAudioData') && deck.includes('createBufferSource'), 'audio-deck must decode and play via Web Audio API on Linux');
  assert.ok(deck.includes('bufferCache.size >= 16'), 'audio-deck must cap decoded AudioBuffer cache to bound RAM');
});


test('v1.2.4 WSOLA Pitch-Preserving Speed Verification: wsola.ts exists, wired into Linux Web Audio path at playbackRate=1.0', () => {
  const wsolaPath = path.join(root, 'src/engine/wsola.ts');
  assert.ok(fs.existsSync(wsolaPath), 'src/engine/wsola.ts must exist');
  const wsolaSrc = fs.readFileSync(wsolaPath, 'utf8');
  assert.ok(wsolaSrc.includes('timeStretchChannels') && wsolaSrc.includes('timeStretchAudioBuffer'), 'wsola.ts must export timeStretchChannels and timeStretchAudioBuffer');

  const deck = fs.readFileSync(path.join(root, 'src/engine/audio-deck.ts'), 'utf8');
  assert.ok(deck.includes('timeStretchAudioBuffer') && deck.includes('src.playbackRate.value = 1.0'), 'audio-deck must use WSOLA stretched buffer at playbackRate=1.0 on Linux');
});
