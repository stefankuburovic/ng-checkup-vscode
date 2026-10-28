// Bundles the extension and its analysis worker into CommonJS files under dist/.
//
// CommonJS because that is what every VS Code (and Cursor) release loads; ng-checkup
// is ESM-only, so it is bundled rather than required. Bundling also keeps the .vsix
// free of node_modules: ng-checkup and TypeScript end up in dist/worker.js only, and
// the extension host file stays small enough to load instantly.
//
// ng-checkup reads its own name and version from `new URL('../package.json',
// import.meta.url)`. In a CommonJS bundle `import.meta.url` is empty and the report
// would say "ng-checkup 0.0.0", so the worker gets a URL that points at a copy of
// ng-checkup's package.json under dist/ng-checkup/.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');

/** Options shared by both bundles. */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

rmSync('dist', { recursive: true, force: true });
await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] });
await build({
  ...common,
  entryPoints: ['src/worker.ts'],
  outfile: 'dist/worker.js',
  define: { 'import.meta.url': '__ngCheckupModuleUrl' },
  banner: { js: "var __ngCheckupModuleUrl = require('node:url').pathToFileURL(require('node:path').join(__dirname, 'ng-checkup', 'dist', 'index.js')).href;" },
});
mkdirSync('dist/ng-checkup', { recursive: true });
copyFileSync('node_modules/ng-checkup/package.json', 'dist/ng-checkup/package.json');
