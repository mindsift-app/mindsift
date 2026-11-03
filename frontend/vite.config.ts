import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Shown in the header. Tag and main builds get APP_VERSION as build argument (e.g. "v0.6.0");
// other builds show the package version with a "-dev" suffix (Semantic Versioning, see CHANGELOG.md).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = process.env.APP_VERSION || `v${pkg.version}-dev`;
// Every build gets its own ID; open pages compare it with version.json to offer a reload (lib/useUpdateCheck)
const appBuild = `${Date.now()}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mindsift-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion, build: appBuild }) });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
