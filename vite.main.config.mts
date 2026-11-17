import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

// The extension libraries (src/extensions.ts) load their own preload scripts
// from next to the main script, so they're copied there.
const extensionPreloads = (): Plugin => ({
  name: 'extension-preloads',
  writeBundle(options) {
    const dir = options.dir ?? path.dirname(options.file ?? '');
    for (const name of [
      'electron-chrome-extensions/preload',
      'electron-chrome-web-store/preload',
    ]) {
      const file = require.resolve(name);
      copyFileSync(file, path.join(dir, path.basename(file)));
    }
  },
});

// https://vitejs.dev/config
export default defineConfig(({ mode }) => ({
  plugins: [extensionPreloads()],
  // In the built app the libraries can't find their preloads as packages
  // (no node_modules) and use the copies above; outside production they
  // log that as an error.
  define:
    mode === 'production'
      ? { 'process.env.NODE_ENV': JSON.stringify('production') }
      : {},
  resolve: {
    // Their ES module builds lose __dirname when bundled into main.cjs (and
    // with it the preload paths), so use the CommonJS builds.
    alias: [
      {
        find: /^electron-chrome-extensions$/,
        replacement: require.resolve('electron-chrome-extensions'),
      },
      {
        find: /^electron-chrome-web-store$/,
        replacement: require.resolve('electron-chrome-web-store'),
      },
    ],
  },
}));
