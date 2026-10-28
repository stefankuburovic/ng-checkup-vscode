import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Analyser } from './analyser.js';
import { countByLevel, toDiagnosticEntries, type DiagnosticEntry, type DiagnosticLevel } from './diagnostics.js';
import type { AnalyseResult } from './protocol.js';
import { withContentSecurityPolicy } from './report-page.js';
import { isAngularWorkspace, triggersRun } from './workspace.js';

/** The README, linked from the status bar tooltip and the report panel's title bar. */
const README_URL = 'https://github.com/stefankuburovic/ng-checkup#readme';

/** VS Code's severity for each level the pure mapping produces. */
const SEVERITIES: Record<DiagnosticLevel, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** The `ng-checkup.*` settings, read fresh on every run so a change applies without a reload. */
interface Settings {
  registryLookup: boolean;
  highSeverity: 'error' | 'warning';
  maxExamples: number;
  runOnSave: boolean;
  debounceMs: number;
}

/** Reads the settings with the defaults `package.json` declares, clamped to sane values. */
function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration('ng-checkup');
  return {
    registryLookup: config.get<boolean>('registryLookup', false),
    highSeverity: config.get<'error' | 'warning'>('highSeverity', 'warning') === 'error' ? 'error' : 'warning',
    maxExamples: Math.max(1, config.get<number>('maxExamples', 1000)),
    runOnSave: config.get<boolean>('runOnSave', true),
    debounceMs: Math.max(0, config.get<number>('debounceMs', 1500)),
  };
}

/** Everything the extension knows about one analysed workspace folder. */
interface FolderState {
  folder: vscode.WorkspaceFolder;
  result?: AnalyseResult;
  entries?: DiagnosticEntry[];
  /** The last run's failure, shown in the status bar until a run succeeds. */
  error?: string;
  running: boolean;
  /** A save arrived during a run: run once more when it ends, so the last save is always analysed. */
  queued: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** The files that hold this folder's diagnostics, so the next run can clear the ones that went away. */
  uris: vscode.Uri[];
  /** The entries per file URI string, for the hover that shows their detail. */
  byFile: Map<string, DiagnosticEntry[]>;
  panel?: vscode.WebviewPanel;
}

/**
 * Owns the extension's state: one `FolderState` per Angular workspace folder,
 * the diagnostic collection, the status bar item and the analysis worker.
 *
 * Runs once per folder at activation and again, debounced, after a save of a
 * file that can change the report (see `triggersRun`). A folder is analysed
 * by one run at a time; saves during a run collapse into a single follow-up
 * run.
 */
class Controller implements vscode.Disposable {
  private readonly states = new Map<string, FolderState>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('ng-checkup');
  private readonly status = vscode.window.createStatusBarItem('ng-checkup.score', vscode.StatusBarAlignment.Left, 0);
  private readonly output = vscode.window.createOutputChannel('ng-checkup');
  private readonly analyser: Analyser;
  /** The last error shown as a notification per folder, so a broken config file does not toast on every save. */
  private readonly notified = new Map<string, string>();

  /** @param extensionUri The installed extension's folder, which holds `dist/worker.js` and the icon. */
  constructor(private readonly extensionUri: vscode.Uri) {
    this.analyser = new Analyser(vscode.Uri.joinPath(extensionUri, 'dist', 'worker.js').fsPath);
    this.status.name = 'ng-checkup score';
    this.status.command = 'ng-checkup.openReport';
  }

  /** Picks up every Angular folder of the workspace and analyses each. */
  start(): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) this.track(folder);
    this.render();
  }

  /** Starts tracking `folder` if it is an Angular workspace on disk; other schemes (remote, virtual) are not read by ng-checkup. */
  track(folder: vscode.WorkspaceFolder): void {
    if (folder.uri.scheme !== 'file' || this.states.has(folder.uri.toString()) || !isAngularWorkspace(folder.uri.fsPath)) return;
    const state: FolderState = { folder, running: false, queued: false, uris: [], byFile: new Map() };
    this.states.set(folder.uri.toString(), state);
    void this.run(state);
  }

  /** Stops tracking `folder` and removes its diagnostics and panel. */
  untrack(folder: vscode.WorkspaceFolder): void {
    const state = this.states.get(folder.uri.toString());
    if (!state) return;
    this.states.delete(folder.uri.toString());
    if (state.timer) clearTimeout(state.timer);
    for (const uri of state.uris) this.diagnostics.delete(uri);
    state.panel?.dispose();
    void this.analyser.reset(folder.uri.fsPath).catch(() => undefined);
    this.render();
  }

  /** Schedules a run of the folder that holds a just-saved file, when the file can change the report. */
  onSave(document: vscode.TextDocument): void {
    const settings = readSettings();
    if (!settings.runOnSave || document.uri.scheme !== 'file' || !triggersRun(document.uri.fsPath)) return;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const state = folder && this.states.get(folder.uri.toString());
    if (state) this.schedule(state, settings.debounceMs);
  }

  /**
   * Re-runs every folder after a settings change. Turning the registry lookup
   * on or off also drops the caches: the registry answers are cached by the
   * dependency stamp, which a settings change does not touch, so without the
   * reset the old answers would stay.
   */
  async onSettingsChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!event.affectsConfiguration('ng-checkup')) return;
    if (event.affectsConfiguration('ng-checkup.registryLookup')) {
      await Promise.all([...this.states.values()].map((state) => this.analyser.reset(state.folder.uri.fsPath).catch(() => undefined)));
    }
    for (const state of this.states.values()) this.schedule(state, 0);
  }

  /** "ng-checkup: Run": analyses every tracked folder now, or says why there is none. */
  async runAll(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) this.track(folder);
    if (this.states.size === 0) {
      void vscode.window.showInformationMessage('ng-checkup found no Angular workspace here: no angular.json, nx.json or project.json in an open folder.');
      return;
    }
    await Promise.all([...this.states.values()].map((state) => this.run(state)));
  }

  /**
   * "ng-checkup: Open report": ng-checkup's HTML report of the current folder
   * in a webview beside the editor. The page is also written to the temp
   * folder, so "Open report in browser" and "save as PDF" work on the same
   * file. Runs the analysis first when there is no report yet.
   */
  async openReport(): Promise<void> {
    const state = await this.pickState();
    if (!state) return;
    const html = (await this.writeReport(state))?.html;
    if (html === undefined) return;
    if (state.panel) {
      state.panel.webview.html = withContentSecurityPolicy(html);
      state.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel('ng-checkup.report', `ng-checkup: ${state.folder.name}`, vscode.ViewColumn.Beside, {
      // The report is one self-contained page with no script; the webview gets none either.
      enableScripts: false,
      localResourceRoots: [],
      enableFindWidget: true,
    });
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'images', 'icon.png');
    panel.webview.html = withContentSecurityPolicy(html);
    panel.onDidDispose(() => {
      if (state.panel === panel) state.panel = undefined;
    });
    state.panel = panel;
  }

  /** "ng-checkup: Open report in browser": the same page in the system browser, where it prints and saves as PDF. */
  async openReportInBrowser(): Promise<void> {
    const state = await this.pickState();
    if (!state) return;
    const file = await this.writeReport(state);
    if (file) await vscode.env.openExternal(vscode.Uri.file(file.path));
  }

  /** Stops the worker and releases every UI element. */
  dispose(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.panel?.dispose();
    }
    this.states.clear();
    this.analyser.dispose();
    this.diagnostics.dispose();
    this.status.dispose();
    this.output.dispose();
  }

  /** Repaints the status bar for whichever folder the active editor is in. */
  render(): void {
    const state = this.currentState();
    if (!state) {
      this.status.hide();
      return;
    }
    const score = state.result ? (state.result.score === undefined ? '–' : String(state.result.score)) : '';
    if (state.running) {
      this.status.text = `$(sync~spin) ng-checkup${score ? ` ${score}` : ''}`;
      this.status.backgroundColor = undefined;
    } else if (state.error) {
      this.status.text = '$(error) ng-checkup';
      this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.status.text = `$(checklist) ng-checkup ${score}`;
      this.status.backgroundColor = undefined;
    }
    this.status.tooltip = this.tooltip(state);
    this.status.show();
  }

  /** Waits `delay` ms after the last call, then runs; each call restarts the wait. */
  private schedule(state: FolderState, delay: number): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.run(state);
    }, delay);
  }

  /**
   * One analysis of one folder, published as diagnostics. A failed run keeps
   * the previous diagnostics: a half-typed config file should not make every
   * finding vanish and come back. A result that arrives after the folder was
   * closed is dropped.
   */
  private async run(state: FolderState): Promise<void> {
    if (state.running) {
      state.queued = true;
      return;
    }
    state.running = true;
    state.queued = false;
    this.render();
    const settings = readSettings();
    const key = state.folder.uri.toString();
    try {
      const result = await this.analyser.analyse(state.folder.uri.fsPath, !settings.registryLookup, settings.maxExamples);
      if (this.states.get(key) !== state) return;
      state.result = result;
      state.error = undefined;
      this.notified.delete(key);
      this.publish(state, toDiagnosticEntries(result.report, { high: settings.highSeverity }));
      this.log(`${state.folder.name}: score ${result.score ?? 'n/a'}, ${state.entries?.length ?? 0} diagnostics, analysed in ${result.report.durationMs} ms${result.configPath ? ` with ${result.configPath}` : ''}`);
    } catch (error) {
      if (this.states.get(key) !== state) return;
      const message = error instanceof Error ? error.message : String(error);
      state.error = message;
      this.log(`${state.folder.name}: ${message}`);
      if (this.notified.get(key) !== message) {
        this.notified.set(key, message);
        void vscode.window.showErrorMessage(`ng-checkup could not analyse ${state.folder.name}: ${message}`, 'Show log').then((choice) => {
          if (choice) this.output.show(true);
        });
      }
    } finally {
      state.running = false;
      this.render();
      if (state.queued && this.states.get(key) === state) void this.run(state);
    }
  }

  /** Replaces the folder's diagnostics with `entries`, clearing files that no longer have any. */
  private publish(state: FolderState, entries: DiagnosticEntry[]): void {
    const byFile = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[]; entries: DiagnosticEntry[] }>();
    for (const entry of entries) {
      let file = byFile.get(entry.path);
      if (!file) {
        file = { uri: vscode.Uri.joinPath(state.folder.uri, ...entry.path.split('/')), diagnostics: [], entries: [] };
        byFile.set(entry.path, file);
      }
      file.diagnostics.push(toDiagnostic(entry));
      file.entries.push(entry);
    }
    for (const uri of state.uris) this.diagnostics.delete(uri);
    for (const file of byFile.values()) this.diagnostics.set(file.uri, file.diagnostics);
    state.uris = [...byFile.values()].map((file) => file.uri);
    state.byFile = new Map([...byFile.values()].map((file) => [file.uri.toString(), file.entries]));
    state.entries = entries;
  }

  /**
   * The detail of the findings on a hovered line: why each matters and what
   * fixing it takes, with a link to its check's documentation. VS Code's own
   * hover already shows the one-line message; this adds what the Problems
   * panel leaves out (see `DiagnosticEntry.message`).
   */
  hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const key = document.uri.toString();
    const entries = [...this.states.values()].flatMap((state) => state.byFile.get(key) ?? []).filter((entry) => entry.line === position.line && entry.detail);
    if (entries.length === 0) return undefined;
    const markdown = new vscode.MarkdownString();
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.message)) continue;
      seen.add(entry.message);
      if (seen.size > 1) markdown.appendMarkdown('\n\n---\n\n');
      markdown.appendMarkdown(`**ng-checkup** · ${escapeMarkdown(entry.message)}\n\n${entry.detail}\n\n[About this check](${entry.docsUrl})`);
    }
    return new vscode.Hover(markdown);
  }

  /** The folder of the active editor when it is tracked, otherwise the first tracked one. */
  private currentState(): FolderState | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    return (folder && this.states.get(folder.uri.toString())) ?? this.states.values().next().value;
  }

  /** The folder a report command applies to: the current one, or the user's pick when several are open and no editor decides. */
  private async pickState(): Promise<FolderState | undefined> {
    if (this.states.size === 0) await this.runAll();
    if (this.states.size <= 1 || vscode.window.activeTextEditor) return this.currentState();
    const pick = await vscode.window.showQuickPick(
      [...this.states.values()].map((state) => ({ label: state.folder.name, description: state.result?.score !== undefined ? `${state.result.score}/100` : undefined, state })),
      { placeHolder: 'Which workspace folder?' },
    );
    return pick?.state;
  }

  /** Renders the folder's report into the temp folder, running the analysis first when there is none. */
  private async writeReport(state: FolderState): Promise<{ path: string; html: string } | undefined> {
    if (!state.result) await this.run(state);
    if (!state.result) return undefined;
    try {
      const html = await this.analyser.html(state.result.report);
      const path = join(tmpdir(), `ng-checkup-${state.folder.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.html`);
      await writeFile(path, html, 'utf8');
      return { path, html };
    } catch (error) {
      void vscode.window.showErrorMessage(`ng-checkup could not write the report: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** The status bar tooltip: score, counts and what a click does. */
  private tooltip(state: FolderState): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.isTrusted = { enabledCommands: ['ng-checkup.run', 'ng-checkup.openReport', 'ng-checkup.openReportInBrowser'] };
    tooltip.appendMarkdown(`**ng-checkup** · ${escapeMarkdown(state.folder.name)}\n\n`);
    if (state.error) tooltip.appendMarkdown(`$(error) ${escapeMarkdown(state.error)}\n\n`);
    if (state.result) {
      const { report, score } = state.result;
      const counts = countByLevel(state.entries ?? []);
      tooltip.appendMarkdown(`Score **${score ?? '–'}/100**${report.project.angularVersion ? ` · Angular ${escapeMarkdown(report.project.angularVersion)}` : ''}\n\n`);
      const parts = [plural(counts.error, 'error'), plural(counts.warning, 'warning'), plural(counts.information, 'info finding')].filter((part): part is string => part !== undefined);
      tooltip.appendMarkdown(`${parts.length > 0 ? parts.join(', ') : 'No findings'} in the Problems panel\n\n`);
    } else if (state.running) {
      tooltip.appendMarkdown('Analysing…\n\n');
    }
    tooltip.appendMarkdown(`[Open report](command:ng-checkup.openReport) · [Run again](command:ng-checkup.run) · [About ng-checkup](${README_URL})`);
    return tooltip;
  }

  /** One timestamped line in the "ng-checkup" output channel. */
  private log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
}

/** A pure-mapping entry as a VS Code diagnostic; the check id links to its documentation. */
function toDiagnostic(entry: DiagnosticEntry): vscode.Diagnostic {
  // The report has no column: the whole line is marked, and VS Code clamps the end to the line's length.
  const diagnostic = new vscode.Diagnostic(new vscode.Range(entry.line, 0, entry.line, Number.MAX_SAFE_INTEGER), entry.message, SEVERITIES[entry.level]);
  diagnostic.source = 'ng-checkup';
  diagnostic.code = { value: entry.checkId, target: vscode.Uri.parse(entry.docsUrl) };
  return diagnostic;
}

/** "3 warnings", or undefined for zero so the tooltip lists only what is there. */
function plural(count: number, noun: string): string | undefined {
  return count === 0 ? undefined : `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Escapes the characters Markdown would read as markup in a folder name or a message. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/**
 * Entry point. Activated by `workspaceContains` on the workspace markers, or by
 * any of the commands in a workspace without them.
 */
export function activate(context: vscode.ExtensionContext): void {
  const controller = new Controller(context.extensionUri);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('ng-checkup.run', () => controller.runAll()),
    vscode.commands.registerCommand('ng-checkup.openReport', () => controller.openReport()),
    vscode.commands.registerCommand('ng-checkup.openReportInBrowser', () => controller.openReportInBrowser()),
    vscode.workspace.onDidSaveTextDocument((document) => controller.onSave(document)),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (document, position) => controller.hover(document, position) }),
    vscode.workspace.onDidChangeConfiguration((event) => controller.onSettingsChanged(event)),
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) controller.untrack(folder);
      for (const folder of event.added) controller.track(folder);
      controller.render();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => controller.render()),
  );
  controller.start();
}

/** Nothing to do: the controller is in `context.subscriptions` and is disposed with them. */
export function deactivate(): void {}
