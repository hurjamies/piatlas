/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Kolme rakennustapaa:
//  - oletus (`npm run build`)            → dist/           tavallinen staattinen sivusto
//  - pages  (`npm run build:pages`)      → dist/           GitHub Pages + offline-service worker
//  - artifact (`npm run build:artifact`) → dist-artifact/  yksi HTML-tiedosto + data/ (claude.ai-julkaisu)
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  const pages = mode === 'pages';
  return {
    base: './',
    plugins: [react(), ...(artifact ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    define: {
      __BUILD_TARGET__: JSON.stringify(artifact ? 'artifact' : pages ? 'pages' : 'web'),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    },
    worker: { format: 'es' },
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      emptyOutDir: true,
      // Yksi sovelluspaketti (myös offline- ja artifact-käytössä); Path Discovery -sivut kasvattivat sitä ~100 kB.
      chunkSizeWarningLimit: 1400,
      assetsInlineLimit: artifact ? 100_000_000 : 4096,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      testTimeout: 60_000,
    },
  };
});
