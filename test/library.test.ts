import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createAnalysisCache, overallScore, runCheckup } from 'ng-checkup-cli';
import { PROJECT_FILE, toDiagnosticEntries } from '../src/diagnostics.js';

/**
 * The contract with the published ng-checkup package: the mapping is tested
 * on hand-made reports above, this checks that a real report has the shape
 * those tests assume (paths relative to the root, one-based lines).
 */
describe('ng-checkup library on the legacy-app fixture', () => {
  const root = resolve(__dirname, 'fixtures/legacy-app');

  it('yields diagnostics with file and line, and a score', async () => {
    const report = await runCheckup(root, { offline: true, maxExamples: 1000, cache: createAnalysisCache() });
    const entries = toDiagnosticEntries(report, { high: 'warning' });
    expect(overallScore(report)).toBeTypeOf('number');
    expect(entries).toContainEqual(expect.objectContaining({ path: 'src/app/app.component.ts', line: 5, checkId: 'type-safety' }));
    expect(entries.some((entry) => entry.path === PROJECT_FILE && entry.checkId === 'version')).toBe(true);
    // From ng-checkup 1.5.0 a strict flag that is off sits on the tsconfig line that sets it (`"strict": false`).
    expect(entries).toContainEqual(expect.objectContaining({ path: 'tsconfig.json', line: 1, checkId: 'type-safety', message: '`strictNullChecks` is off (Type safety)' }));
    expect(entries.every((entry) => !entry.path.startsWith('/') && !entry.path.includes('\\'))).toBe(true);
  });

  it('shows the findings of ng-checkup 2.1 on the line that causes them', async () => {
    const app = mkdtempSync(join(tmpdir(), 'ng-checkup-vscode-'));
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'app', dependencies: { '@angular/core': '^20.0.0' } }),
      'angular.json': JSON.stringify({ projects: { app: { root: '', projectType: 'application', architect: { build: { builder: '@angular/build:application', options: { browser: 'src/main.ts' } } } } } }),
      'src/main.ts': "import moment from 'moment';\nimport './a.component';\nmoment();\n",
      'src/a.component.ts': "import { Component } from '@angular/core';\n@Component({ selector: 'app-a', templateUrl: './a.component.html' })\nexport class AComponent { total() { return 1; } }\n",
      'src/a.component.html': '<p>x</p>\n{{ total() }}\n<li *ngFor="let a of rows"></li>\n',
    };
    try {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(app, path)), { recursive: true });
        writeFileSync(join(app, path), content);
      }
      const entries = toDiagnosticEntries(await runCheckup(app, { offline: true, maxExamples: 1000 }), { high: 'warning' });
      // Lines here are zero-based, as VS Code wants them.
      expect(entries).toContainEqual(expect.objectContaining({ path: 'src/a.component.html', line: 1, checkId: 'components', message: expect.stringContaining('method call') }));
      expect(entries).toContainEqual(expect.objectContaining({ path: 'src/a.component.html', line: 2, checkId: 'components', message: expect.stringContaining('trackBy') }));
      expect(entries).toContainEqual(expect.objectContaining({ path: 'src/main.ts', line: 0, checkId: 'bundle', message: expect.stringContaining('moment') }));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
