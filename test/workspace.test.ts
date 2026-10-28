import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAngularWorkspace, triggersRun } from '../src/workspace.js';

describe('isAngularWorkspace', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ng-checkup-vscode-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(['angular.json', 'nx.json', 'project.json'])('accepts a folder with %s at the root', (marker) => {
    writeFileSync(join(root, marker), '{}');
    expect(isAngularWorkspace(root)).toBe(true);
  });

  it('accepts an angular.json one folder down', () => {
    mkdirSync(join(root, 'frontend'));
    writeFileSync(join(root, 'frontend', 'angular.json'), '{}');
    expect(isAngularWorkspace(root)).toBe(true);
  });

  it('ignores an angular.json inside node_modules and a folder without markers', () => {
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'angular.json'), '{}');
    writeFileSync(join(root, 'package.json'), '{}');
    expect(isAngularWorkspace(root)).toBe(false);
  });

  it('says no for a folder that does not exist', () => {
    expect(isAngularWorkspace(join(root, 'missing'))).toBe(false);
  });
});

describe('triggersRun', () => {
  it.each(['/w/src/app.component.ts', '/w/src/app.component.html', '/w/package.json', '/w/ng-checkup.config.json', '/w/tsconfig.app.json', '/w/apps/a/project.json'])('runs after saving %s', (path) => {
    expect(triggersRun(path)).toBe(true);
  });

  it.each(['/w/README.md', '/w/src/styles.scss', '/w/src/typings.d.ts', '/w/package-lock.json'])('does not run after saving %s', (path) => {
    expect(triggersRun(path)).toBe(false);
  });
});
