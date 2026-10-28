import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The files that make a folder an Angular workspace for ng-checkup: an
 * Angular CLI workspace, an Nx workspace, or a standalone Nx project. The
 * same three are the extension's `workspaceContains` activation events, so a
 * folder that never activates the extension is never analysed either.
 */
export const WORKSPACE_MARKERS = ['angular.json', 'nx.json', 'project.json'] as const;

/** Folders never looked into for a nested `angular.json`: dependencies, VCS and build output. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', '.angular', '.nx']);

/**
 * True when `root` is an Angular workspace: one of `WORKSPACE_MARKERS` at the
 * root, or an `angular.json` one level down. The second case is a repository
 * that keeps the app in `frontend/` or `client/`; ng-checkup finds that
 * workspace itself when it is given the repository root, so the extension
 * analyses the folder the user opened rather than guessing the subfolder.
 * Deeper nesting is left out on purpose: walking a monorepo on every start
 * would cost more than it finds.
 */
export function isAngularWorkspace(root: string): boolean {
  if (WORKSPACE_MARKERS.some((marker) => existsSync(join(root, marker)))) return true;
  try {
    return readdirSync(root, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name) && existsSync(join(root, entry.name, 'angular.json')),
    );
  } catch {
    // An unreadable folder is not one to analyse.
    return false;
  }
}

/** Files whose save changes the workspace's shape rather than one source file. */
const CONFIG_FILES = new Set(['package.json', 'ng-checkup.config.json', 'angular.json', 'nx.json', 'project.json']);

/**
 * True when saving `path` can change the report: TypeScript and templates,
 * the workspace and package files, the ng-checkup config and any tsconfig
 * (strict flags are graded). A save of a Markdown file or a stylesheet does
 * not start a run, since nothing in it is analysed.
 */
export function triggersRun(path: string): boolean {
  const name = basename(path);
  if (CONFIG_FILES.has(name)) return true;
  if (/^tsconfig.*\.json$/.test(name)) return true;
  return /\.(ts|mts|cts|html)$/.test(name) && !name.endsWith('.d.ts');
}
