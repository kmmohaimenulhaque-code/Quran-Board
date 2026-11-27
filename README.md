# Tactile Quran Recitation Instrument (Phase 1)

Cross-platform Quran recitation and memorization instrument modeled as a dual-face physical hardware slab:
- **Face A (Control Deck):** Matte-black anodized slab with coral-amber backlit labels, custom SVG 7-segment LEDs with ghost `88` segments, and press-and-hold concave circular rocker pairs.
- **Face B (Recitation Slate):** Cool dark matte charcoal-blue slab with dashed cyan perimeter and 8 ruled horizontal lines where Arabic Uthmani verses reveal **one word at a time** with zero text reflow.

## Integrated Surah Al-Baqarah (Reciter 01 — Qari Muhammad Shamim)
- `public/audio/baqarah-preview.mp3` and `src/assets/data/shamim-baqarah-timings.json` ship pre-wired for Surah Al-Baqarah `2:1–2:10` (Pages 2 & 3).
- To use the full 2h 29m Surah Al-Baqarah MP3 locally, place it at `public/audio/shamim-baqarah.mp3` and update `localAudioPath` in `src/assets/data/reciters.json`.

## Quick Start
```bash
npm install
npm run generate:mushaf   # Optional: downloads all 604 Madani Mushaf pages offline
npm run test              # Runs pure TypeScript core unit tests
npm run build             # Type-checks (strict) and builds production bundle
npm run dev               # Launches local dev server
```
