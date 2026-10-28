import { resolve } from 'node:path';
import { createAnalysisCache, overallScore, runCheckup } from 'ng-checkup';
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
    expect(entries.every((entry) => !entry.path.startsWith('/') && !entry.path.includes('\\'))).toBe(true);
  });
});
