# Changelog

## 0.3.0

- Bundles ng-checkup 1.6.1 (published on npm as `ng-checkup-cli`): files nothing imports, and components and pipes no template uses, show as findings on their own line.
- New setting `ng-checkup.attributeSelectors` (or `"attributeSelectors": true` in `ng-checkup.config.json`): also directives no template matches, and inputs and outputs no template binds.

## 0.2.0

- Bundles ng-checkup 1.5.0: a strict flag that is off (`strictNullChecks`, `noImplicitAny`, `strictTemplates`) shows on the tsconfig line that sets it, following `extends`, instead of on `package.json`.

## 0.1.0

First release.

- ng-checkup findings in the Problems panel and inline, with file and line; findings about the whole project (an outdated Angular, an end-of-life package, a strict flag that is off) sit on `package.json`.
- The overall score in the status bar; a click opens the full HTML report beside the editor.
- Runs when an Angular CLI or Nx workspace is opened, and again after a save. Only changed files are parsed again, in a worker thread, so the editor never waits.
- Reads `ng-checkup.config.json` (`ignore`, `only`, `skip`, `offline`).
- Offline by default; the `ng-checkup.registryLookup` setting turns the npm registry lookup on.
- Bundles ng-checkup 1.4.1.
