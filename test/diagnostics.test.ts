import type { CheckResult, Finding, Report } from 'ng-checkup';
import { DOCS_URL, PROJECT_FILE, countByLevel, toDiagnosticEntries } from '../src/diagnostics.js';

/** A check with the given findings and nothing else that the mapping reads. */
function check(id: string, title: string, findings: Finding[]): CheckResult {
  return { id, title, grade: 'fair', summary: '', metrics: [], findings };
}

/** A report holding only checks, which is all `toDiagnosticEntries` takes. */
function report(...checks: CheckResult[]): Pick<Report, 'checks'> {
  return { checks };
}

describe('toDiagnosticEntries', () => {
  it('makes one entry per example file, with the line turned zero-based', () => {
    const entries = toDiagnosticEntries(
      report(check('type-safety', 'Type safety', [{ severity: 'medium', message: '2 explicit `any`', files: [{ path: 'src/a.ts', line: 6 }, { path: 'src/b.ts', line: 9 }], count: 2 }])),
      { high: 'warning' },
    );
    expect(entries.map((entry) => [entry.path, entry.line])).toEqual([
      ['src/a.ts', 5],
      ['src/b.ts', 8],
    ]);
    expect(entries[0]).toMatchObject({ level: 'warning', checkId: 'type-safety', docsUrl: `${DOCS_URL}#type-safety`, message: '2 explicit `any` (Type safety)' });
  });

  it('puts a finding about a whole file on its first line', () => {
    const [entry] = toDiagnosticEntries(report(check('testing', 'Testing', [{ severity: 'medium', message: 'No spec', files: [{ path: 'src/a.service.ts' }] }])), { high: 'warning' });
    expect(entry).toMatchObject({ path: 'src/a.service.ts', line: 0 });
  });

  it('puts a finding about the whole project on package.json, as the SARIF renderer does', () => {
    const [entry] = toDiagnosticEntries(report(check('version', 'Angular version & tooling', [{ severity: 'high', message: 'Angular 15 is 7 majors behind 22' }])), { high: 'warning' });
    expect(entry).toMatchObject({ path: PROJECT_FILE, line: 0 });
  });

  it('maps severities, with high following the setting and info as a hint', () => {
    const findings: Finding[] = (['high', 'medium', 'low', 'info'] as const).map((severity) => ({ severity, message: severity, files: [{ path: `${severity}.ts` }] }));
    expect(toDiagnosticEntries(report(check('x', 'X', findings)), { high: 'warning' }).map((entry) => entry.level)).toEqual(['warning', 'warning', 'information', 'hint']);
    expect(toDiagnosticEntries(report(check('x', 'X', findings)), { high: 'error' })[0]?.level).toBe('error');
  });

  it('keeps the message on one line and the detail apart, for the hover', () => {
    const [entry] = toDiagnosticEntries(report(check('x', 'X', [{ severity: 'low', message: 'Short', detail: 'Why it matters.' }])), { high: 'warning' });
    expect(entry).toMatchObject({ message: 'Short (X)', detail: 'Why it matters.' });
  });

  it('says how many locations a capped finding left out', () => {
    const [entry] = toDiagnosticEntries(report(check('x', 'X', [{ severity: 'low', message: 'Many', files: [{ path: 'a.ts', line: 1 }], count: 4 }])), { high: 'warning' });
    expect(entry?.detail).toContain('3 more locations not listed');
  });

  it('does not invent left-out locations for a count without files', () => {
    const [entry] = toDiagnosticEntries(report(check('x', 'X', [{ severity: 'medium', message: '2 `@Input()` left', count: 2 }])), { high: 'warning' });
    expect(entry?.message).toBe('2 `@Input()` left (X)');
    expect(entry?.detail).toBeUndefined();
  });

  it('drops a duplicate of the same finding on the same line', () => {
    const entries = toDiagnosticEntries(report(check('x', 'X', [{ severity: 'low', message: 'Twice', files: [{ path: 'a.ts', line: 3 }, { path: 'a.ts', line: 3 }] }])), { high: 'warning' });
    expect(entries).toHaveLength(1);
  });

  it('returns nothing for a report without findings', () => {
    expect(toDiagnosticEntries(report(check('x', 'X', [])), { high: 'warning' })).toEqual([]);
  });
});

describe('countByLevel', () => {
  it('counts every level, zero included', () => {
    const entries = toDiagnosticEntries(report(check('x', 'X', [{ severity: 'medium', message: 'a' }, { severity: 'low', message: 'b' }, { severity: 'low', message: 'c' }])), { high: 'warning' });
    expect(countByLevel(entries)).toEqual({ error: 0, warning: 1, information: 2, hint: 0 });
  });
});
