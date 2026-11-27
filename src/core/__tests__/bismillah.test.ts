import { describe, it, expect } from 'vitest';
import bundledPages from '../../assets/data/mushaf-604.json';
import { BISMILLAH_TEXT, expandVersesWithBismillah, stripLeadingBismillah } from '../bismillah';

describe('Per-Reciter Bismillah Recitation & Stripping Rules', () => {
  it('strips API-prepended Bismillah from Ayah 1 of non-Fatihah/non-Tawbah Surahs', () => {
    const apiYasin1 = `${BISMILLAH_TEXT} يسٓ`;
    expect(stripLeadingBismillah(apiYasin1, 36, 1)).toBe('يسٓ');
    expect(stripLeadingBismillah(BISMILLAH_TEXT, 1, 1)).toBe(BISMILLAH_TEXT);
  });

  it('never injects duplicate Bismillah for Surah 1 (Al-Fatihah) or Surah 9 (At-Tawbah)', () => {
    const fatihah = expandVersesWithBismillah(bundledPages['1']);
    expect(fatihah.some((v) => v.isBismillah)).toBe(false);

    const tawbah = expandVersesWithBismillah([
      { verseKey: '9:1', surah: 9, ayah: 1, textUthmani: 'بَرَآءَةٌ مِّنَ ٱللَّهِ وَرَسُولِهِۦ' }
    ]);
    expect(tawbah.length).toBe(1);
    expect(tawbah[0].isBismillah).toBeUndefined();
  });

  it('prepends recited Bismillah before Ayah 1 of Surah Al-Baqarah and all 3 Surahs on Page 604', () => {
    const baqarah = expandVersesWithBismillah(bundledPages['2']);
    expect(baqarah[0].isBismillah).toBe(true);
    expect(baqarah[0].verseKey).toBe('2:0');
    expect(baqarah[1].verseKey).toBe('2:1');

    const p604 = expandVersesWithBismillah(bundledPages['604']);
    const bismillahs = p604.filter((v) => v.isBismillah);
    expect(bismillahs.map((b) => b.verseKey)).toEqual(['112:0', '113:0', '114:0']);
  });
});
