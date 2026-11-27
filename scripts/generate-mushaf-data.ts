/**
 * Build-time script to populate src/assets/data/mushaf-604.json with all 604 Madani Mushaf pages
 * using public unauthenticated AlQuran Cloud Uthmani JSON.
 *
 * Run: npm run generate:mushaf
 */
import fs from 'node:fs/promises';
import path from 'node:path';

interface AlQuranAyah {
  numberInSurah: number;
  page: number;
  text: string;
}

interface AlQuranSurah {
  number: number;
  ayahs: AlQuranAyah[];
}

async function main() {
  const res = await fetch('https://api.alquran.cloud/v1/quran/quran-uthmani');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = (await res.json()) as { data: { surahs: AlQuranSurah[] } };

  const pages: Record<string, Array<{ verseKey: string; surah: number; ayah: number; textUthmani: string }>> = {};

  for (const surah of payload.data.surahs) {
    for (const ayah of surah.ayahs) {
      const key = String(ayah.page);
      if (!pages[key]) pages[key] = [];
      pages[key].push({
        verseKey: `${surah.number}:${ayah.numberInSurah}`,
        surah: surah.number,
        ayah: ayah.numberInSurah,
        textUthmani: ayah.text
      });
    }
  }

  const outPath = path.resolve(process.cwd(), 'src/assets/data/mushaf-604.json');
  await fs.writeFile(outPath, JSON.stringify(pages, null, 2), 'utf-8');
  console.log(`Generated ${Object.keys(pages).length} Madani Mushaf pages -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
