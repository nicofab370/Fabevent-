import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FabEvent',
        short_name: 'FabEvent',
        description: 'Gestion de location de matériel et prestation technique',
        lang: 'fr',
        start_url: './',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      // tout est mis en cache pour fonctionner hors ligne, y compris le scanner (wasm) et le lecteur de PDF
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,wasm}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
    }),
  ],
});
