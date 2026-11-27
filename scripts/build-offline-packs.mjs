/**
 * Maximum-Compression Full-Quran Offline Audio Pack Builder (24kbps Mono Opus VBR).
 *
 * Downloads all 6,236 ayahs for EveryAyah reciters (02..06, including Yasser Al-Dosari),
 * transcodes each ayah to 24kbps Mono Opus (~250-290 MB per full Quran with crisp voice quality),
 * measures exact durationMs via ffprobe, and writes a per-reciter manifest.json for zero-lag sync.
 *
 * Also compresses a local Surah Al-Baqarah MP3 for Reciter 01 (Qari Muhammad Shamim) if present.
 *
 * Usage:
 *   node scripts/build-offline-packs.mjs --reciters=all --format=opus --concurrency=6
 *   node scripts/build-offline-packs.mjs --reciters=06-dosari --surahs=1,2,36,67,112-114
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const FORMAT = args.format === 'm4a' ? 'm4a' : 'opus';
const CONCURRENCY = Math.max(1, Number(args.concurrency || 6));
const OUT_ROOT = path.join(ROOT, 'public/audio-packs');

const reciters = JSON.parse(await fs.readFile(path.join(ROOT, 'src/assets/data/reciters.json'), 'utf8'));
const surahs = JSON.parse(await fs.readFile(path.join(ROOT, 'src/assets/data/surahs-114.json'), 'utf8'));

function pad3(n) { return String(n).padStart(3, '0'); }

function parseSurahFilter(spec) {
  if (!spec || spec === 'all') return new Set(surahs.map((s) => s.id));
  const out = new Set();
  for (const part of spec.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      out.add(Number(part));
    }
  }
  return out;
}

async function transcodeToSmallestVoice(inputPath, outputPath) {
  const codecArgs =
    FORMAT === 'm4a'
      ? ['-c:a', 'aac', '-ac', '1', '-ar', '24000', '-b:a', '32k', '-movflags', '+faststart']
      : ['-c:a', 'libopus', '-ac', '1', '-ar', '24000', '-b:a', '24k', '-vbr', 'on', '-compression_level', '10', '-application', 'voip'];

  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inputPath, ...codecArgs, outputPath]);
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    outputPath
  ]);
  return Math.round(parseFloat(stdout.trim()) * 1000) || 0;
}

async function downloadAndCompressAyah(reciter, surahId, ayahNum, outDir) {
  const key = `${pad3(surahId)}${pad3(ayahNum)}`;
  const ext = FORMAT === 'm4a' ? 'm4a' : 'opus';
  const finalPath = path.join(outDir, `${key}.${ext}`);
  if (existsSync(finalPath)) {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', finalPath
    ]);
    return { verseKey: `${surahId}:${ayahNum}`, file: `${key}.${ext}`, durationMs: Math.round(parseFloat(stdout.trim()) * 1000) || 0 };
  }

  const url = `https://everyayah.com/data/${reciter.everyAyahDir}/${key}.mp3`;
  const tmpMp3 = path.join(outDir, `${key}.tmp.mp3`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await fs.writeFile(tmpMp3, Buffer.from(await res.arrayBuffer()));
  try {
    const durationMs = await transcodeToSmallestVoice(tmpMp3, finalPath);
    return { verseKey: `${surahId}:${ayahNum}`, file: `${key}.${ext}`, durationMs };
  } finally {
    await fs.rm(tmpMp3, { force: true });
  }
}

async function runPool(items, worker, limit) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function main() {
  const filterReciters = args.reciters && args.reciters !== 'all'
    ? new Set(args.reciters.split(','))
    : null;
  const surahFilter = parseSurahFilter(args.surahs);

  await fs.mkdir(OUT_ROOT, { recursive: true });

  // Compress local Qari Muhammad Shamim Surah Al-Baqarah if present
  const localShamim = path.join(ROOT, 'public/audio/shamim-baqarah.mp3');
  if ((!filterReciters || filterReciters.has('01-shamim')) && existsSync(localShamim)) {
    const shamimDir = path.join(OUT_ROOT, '01-shamim');
    await fs.mkdir(shamimDir, { recursive: true });
    const outFile = path.join(shamimDir, `002-full.${FORMAT}`);
    console.log(`[01-shamim] Compressing local Surah Al-Baqarah -> ${outFile}`);
    const dur = await transcodeToSmallestVoice(localShamim, outFile);
    await fs.writeFile(
      path.join(shamimDir, 'manifest.json'),
      JSON.stringify({ reciterId: 1, format: FORMAT, fullBaqarahFile: path.basename(outFile), durationMs: dur }, null, 2)
    );
  }

  for (const rec of reciters) {
    if (rec.providerMode !== 'everyayah') continue;
    if (filterReciters && !filterReciters.has(rec.slug) && !filterReciters.has(String(rec.id))) continue;

    const outDir = path.join(OUT_ROOT, rec.slug);
    await fs.mkdir(outDir, { recursive: true });

    const jobs = [];
    for (const s of surahs) {
      if (!surahFilter.has(s.id)) continue;
      for (let a = 1; a <= s.ayahs; a++) jobs.push({ surahId: s.id, ayahNum: a });
    }

    console.log(`[${rec.slug}] Building ${jobs.length} ayahs (${FORMAT.toUpperCase()} 24kbps Mono)...`);
    let done = 0;
    const entries = await runPool(
      jobs,
      async (j) => {
        const res = await downloadAndCompressAyah(rec, j.surahId, j.ayahNum, outDir);
        done++;
        if (done % 250 === 0 || done === jobs.length) {
          console.log(`  [${rec.slug}] ${done}/${jobs.length} ayahs ready`);
        }
        return res;
      },
      CONCURRENCY
    );

    const manifest = {
      reciterId: rec.id,
      slug: rec.slug,
      name: rec.name,
      format: FORMAT,
      totalAyahs: entries.length,
      durations: Object.fromEntries(entries.map((e) => [e.verseKey, e.durationMs]))
    };
    await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
    console.log(`[${rec.slug}] Manifest written (${entries.length} verses).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
