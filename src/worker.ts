import { parentPort } from 'node:worker_threads';
import { createAnalysisCache, loadConfig, overallScore, renderHtml, runCheckup, type AnalysisCache } from 'ng-checkup';
import type { AnalyseRequest, AnalyseResult, WorkerRequest, WorkerResponse } from './protocol.js';

/**
 * The analysis worker. ng-checkup parses every TypeScript file and template
 * synchronously; on a large workspace that is seconds of CPU, and in the
 * extension host it would freeze every other extension on each save. In a
 * worker thread it costs the editor nothing.
 *
 * It owns one `AnalysisCache` per root, which is why it lives as long as the
 * extension: a run after a save re-parses only the files whose stamp changed
 * and repeats no registry request. Requests are answered in the order they
 * arrive; the extension never sends a second analysis of the same root before
 * the first one answered.
 */
const caches = new Map<string, AnalysisCache>();

/**
 * One analysis, with `ng-checkup.config.json` applied the way the CLI applies
 * it: `ignore`, `only` and `skip` narrow the report, and `offline: true` in
 * the file wins over the setting, since a team that wrote it down does not
 * want the registry asked from anyone's editor either.
 *
 * @throws The config file's own error (malformed JSON, unknown key) or an
 *   unknown check id, both with a message meant for the user.
 */
async function analyse(request: AnalyseRequest): Promise<AnalyseResult> {
  const { config, path } = loadConfig(request.root);
  let cache = caches.get(request.root);
  if (!cache) {
    cache = createAnalysisCache();
    caches.set(request.root, cache);
  }
  const report = await runCheckup(request.root, {
    offline: request.offline || config.offline === true,
    maxExamples: request.maxExamples,
    cache,
    ...(config.ignore ? { ignore: config.ignore } : {}),
    ...(config.only ? { only: config.only } : {}),
    ...(config.skip ? { skip: config.skip } : {}),
  });
  return { report, score: overallScore(report), ...(path ? { configPath: path } : {}) };
}

/** Answers one request; every failure becomes an `ok: false` reply rather than a crashed worker. */
async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    switch (request.type) {
      case 'analyse':
        return { id: request.id, ok: true, value: await analyse(request) };
      case 'html':
        return { id: request.id, ok: true, value: renderHtml(request.report) };
      case 'reset':
        caches.delete(request.root);
        return { id: request.id, ok: true, value: undefined };
    }
  } catch (error) {
    return { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  void handle(request).then((response) => parentPort?.postMessage(response));
});
