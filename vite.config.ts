import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'audio/baqarah-preview.mp3'],
      manifest: {
        name: 'Tactile Quran Recitation Instrument',
        short_name: 'Quran Instrument',
        description: 'Minimalist dual-face hardware Quran recitation and memorization instrument.',
        theme_color: '#0B0D10',
        background_color: '#0B0D10',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,json,mp3}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/everyayah\.com\/data\/.+\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'quran-instrument-audio-v1',
              expiration: { maxEntries: 6500, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/(api\.alquran\.cloud|api\.quran\.com)\/.+/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'quran-instrument-pages-v1',
              expiration: { maxEntries: 700, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
