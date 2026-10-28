import type { Report } from 'ng-checkup';

/**
 * The messages between the extension and its analysis worker. A separate
 * module so both sides compile against the same shapes; it holds types only
 * and adds nothing to either bundle.
 */

/** Analyse one workspace folder. */
export interface AnalyseRequest {
  type: 'analyse';
  id: number;
  /** Absolute path of the workspace folder. */
  root: string;
  /** True unless the user turned the registry lookup on (and the config file does not say offline). */
  offline: boolean;
  maxExamples: number;
}

/** Render a report the worker returned earlier as ng-checkup's self-contained HTML page. */
export interface HtmlRequest {
  type: 'html';
  id: number;
  report: Report;
}

/** Forget the cached facts of one root, so the next run re-reads every file and the registry answers. */
export interface ResetRequest {
  type: 'reset';
  id: number;
  root: string;
}

export type WorkerRequest = AnalyseRequest | HtmlRequest | ResetRequest;

/** The answer to an `AnalyseRequest`. */
export interface AnalyseResult {
  report: Report;
  /** `overallScore(report)`: undefined when every area is `info`, which the status bar shows as a dash. */
  score: number | undefined;
  /** The config file that was applied, for the tooltip; absent when there is none. */
  configPath?: string;
}

/** Every reply carries the request id; `ok: false` carries a message meant for the user. */
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; message: string };
