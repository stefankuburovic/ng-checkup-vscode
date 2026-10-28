# Changelog

## 0.1.0

First release.

- ng-checkup findings in the Problems panel and inline, with file and line; findings about the whole project (an outdated Angular, an end-of-life package, a strict flag that is off) sit on `package.json`.
- The overall score in the status bar; a click opens the full HTML report beside the editor.
- Runs when an Angular CLI or Nx workspace is opened, and again after a save. Only changed files are parsed again, in a worker thread, so the editor never waits.
- Reads `ng-checkup.config.json` (`ignore`, `only`, `skip`, `offline`).
- Offline by default; the `ng-checkup.registryLookup` setting turns the npm registry lookup on.
- Bundles ng-checkup 1.4.1.
