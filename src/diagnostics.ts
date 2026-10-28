import type { Finding, Report, Severity } from 'ng-checkup';

/**
 * Where each check is documented. The Problems panel turns a diagnostic's
 * code into a link, so every finding points at the page that explains its
 * check; the anchors are the check ids, as in the SARIF renderer.
 */
export const DOCS_URL = 'https://github.com/stefankuburovic/ng-checkup/blob/main/docs/checks.md';

/**
 * The file a finding about the project as a whole is attached to (an outdated
 * Angular, a package that blocks the upgrade). Same rule as ng-checkup's SARIF
 * renderer, so an editor and GitHub code scanning put such a finding in the
 * same place.
 */
export const PROJECT_FILE = 'package.json';

/**
 * A VS Code severity, spelled as a string so this module stays free of the
 * `vscode` import and its mapping can be unit-tested in plain Node.
 */
export type DiagnosticLevel = 'error' | 'warning' | 'information' | 'hint';

/**
 * One diagnostic to show, before it becomes a `vscode.Diagnostic`. The
 * extension groups these by `path` and owns the conversion; everything that
 * decides what a user reads lives here.
 */
export interface DiagnosticEntry {
  /** Relative to the analysed root, with forward slashes, exactly as the report has it. */
  path: string;
  /** Zero-based, as VS Code counts. A finding about a whole file is on line 0. */
  line: number;
  level: DiagnosticLevel;
  /**
   * One line: the finding, then its check in parentheses. One line because the
   * Problems panel expands a multi-line message in place, and a list of 30
   * findings with their paragraphs is unreadable there.
   */
  message: string;
  /** Why it matters and what fixing it takes, plus the count of unlisted locations; shown in the editor hover. */
  detail?: string;
  /** The check id, shown as the diagnostic code and used as the docs anchor. */
  checkId: string;
  /** `DOCS_URL` with the check's anchor. */
  docsUrl: string;
}

/** What the user can tune about the mapping. */
export interface MappingOptions {
  /**
   * How a `high` finding shows. Warning by default: these are modernisation
   * debts, not compile errors, and red squiggles on code that builds would
   * teach people to switch the extension off. Teams that gate on ng-checkup
   * in CI can make them errors to match what CI fails on.
   */
  high: 'error' | 'warning';
}

/**
 * The editor severity per finding severity. `info` findings are notes about
 * the run itself (no build stats, nothing installed) rather than something to
 * fix in the code, so they get the quietest level.
 */
function levelOf(severity: Severity, options: MappingOptions): DiagnosticLevel {
  switch (severity) {
    case 'high':
      return options.high;
    case 'medium':
      return 'warning';
    case 'low':
      return 'information';
    default:
      return 'hint';
  }
}

/**
 * Every finding of a report as editor diagnostics: one per example location,
 * or one on `package.json` for a finding with no file.
 *
 * The report lists only `maxExamples` locations per finding, so the extension
 * asks for a large number; when a finding is still capped, its detail says
 * how many locations were left out instead of pretending the list is
 * complete. Identical entries (the same finding twice on one line) are
 * dropped, since a duplicate diagnostic is noise in the Problems panel.
 *
 * @returns The entries in report order: by check, then finding, then file.
 */
export function toDiagnosticEntries(report: Pick<Report, 'checks'>, options: MappingOptions): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];
  const seen = new Set<string>();
  for (const check of report.checks) {
    for (const finding of check.findings) {
      const message = `${finding.message} (${check.title})`;
      const detail = detailOf(finding);
      const level = levelOf(finding.severity, options);
      const files = finding.files && finding.files.length > 0 ? finding.files : [{ path: PROJECT_FILE }];
      for (const file of files) {
        const line = file.line !== undefined && file.line > 0 ? file.line - 1 : 0;
        const key = `${file.path}\u0000${line}\u0000${check.id}\u0000${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ path: file.path, line, level, message, ...(detail ? { detail } : {}), checkId: check.id, docsUrl: `${DOCS_URL}#${check.id}` });
      }
    }
  }
  return entries;
}

/**
 * The text behind a finding: ng-checkup's detail, and, when the report still
 * capped the finding's locations, how many it left out, so the list never
 * pretends to be complete. Backticks are kept: they mark code in ng-checkup's
 * text, and the hover renders them as Markdown.
 */
function detailOf(finding: Finding): string | undefined {
  const listed = finding.files?.length ?? 0;
  const more = finding.count !== undefined && listed > 0 ? finding.count - listed : 0;
  const parts = [finding.detail, more > 0 ? `${more} more location${more === 1 ? '' : 's'} not listed; raise the \`ng-checkup.maxExamples\` setting to see them all.` : undefined];
  const text = parts.filter((part): part is string => Boolean(part)).join('\n\n');
  return text || undefined;
}

/** Counts per level, for the status bar tooltip. */
export function countByLevel(entries: readonly DiagnosticEntry[]): Record<DiagnosticLevel, number> {
  const counts: Record<DiagnosticLevel, number> = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const entry of entries) counts[entry.level]++;
  return counts;
}
