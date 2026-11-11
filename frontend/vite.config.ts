import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Shown in the header. Tag and main builds get APP_VERSION as build argument (e.g. "v0.6.0");
// other builds show the package version with a "-dev" suffix (Semantic Versioning, see CHANGELOG.md).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = process.env.APP_VERSION || `v${pkg.version}-dev`;
// Every build gets its own ID; open pages compare it with version.json to offer a reload (lib/useUpdateCheck)
const appBuild = `${Date.now()}`;

// Writes the files of the build under /assets/ into the service worker (PRECACHE in public/sw.js), which
// loads them all when it installs, so the app starts offline after the first visit
function precacheList(): Plugin {
  let outDir = 'dist';
  let files: string[] = [];
  return {
    name: 'mindsift-precache-list',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      files = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/'))
        .sort()
        .map((name) => `/${name}`);
    },
    closeBundle() {
      const path = resolve(outDir, 'sw.js');
      const sw = readFileSync(path, 'utf8');
      if (!sw.includes('const PRECACHE = [];')) throw new Error('public/sw.js: "const PRECACHE = [];" not found');
      writeFileSync(path, sw.replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files)};`));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mindsift-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion, build: appBuild }) });
      },
    },
    precacheList(),
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
    // The app's chunk is one file on purpose (src/app/mainViews.ts), loaded right after signing in; about 930 kB,
    // the limit warns when something large (such as a library meant to load on demand) lands in it again
    chunkSizeWarningLimit: 1000,
  },
});
