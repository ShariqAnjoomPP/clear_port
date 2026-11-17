import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ClearPort — Clearance & Delivery',
        short_name: 'ClearPort',
        description: 'Customs clearance and delivery management for port clearing agents',
        theme_color: '#f6faf9',
        background_color: '#f6faf9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Field users can still read their tasks and jobs with no signal (writes go to the IndexedDB outbox).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/documents/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: { cacheName: 'api-reads', networkTimeoutSeconds: 4, expiration: { maxEntries: 200, maxAgeSeconds: 86400 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in dev, exactly like CloudFront → API Gateway in production. Paths keep the /api/<function> prefix.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  // Lite prototype: keep Vite's cache and build output away from the committed node_modules/.vite and dist/ folders.
  cacheDir: 'node_modules/.cache/vite',
  build: {
    outDir: 'dist-lite',
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom'], router: ['@tanstack/react-router', '@tanstack/react-query'] } },
    },
  },
});
