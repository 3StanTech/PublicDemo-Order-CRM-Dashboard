import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  // React ecosystem — keep router with the framework runtime.
  if (
    id.includes('node_modules/react-dom') ||
    id.includes('node_modules/react-router') ||
    id.includes('node_modules/scheduler') ||
    /node_modules\/react\//.test(id)
  ) {
    return 'framework'
  }

  return undefined
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Gelly Dashboard',
        short_name: 'Gelly',
        description: 'Public demo of a mobile-first café order & customer management PWA.',
        theme_color: '#4F74C8',
        background_color: '#FBF3D5',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})
