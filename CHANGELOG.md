# Changelog

## 0.6.0

- Bundles ng-checkup 2.2.0. In an app that renders on the server, browser globals and native DOM changes in code that runs there show at their lines, as do `ngSkipHydration` and, in the translation files, messages without a translation. None of them is graded, so the status-bar score is the same as before on the same code.

## 0.5.0

- Bundles ng-checkup 2.1.0. New findings show where they sit: `*ngFor` without `trackBy`, `@for` with `track $index` and method calls in template bindings in the templates that have them, impure pipes on the pipe class, and `moment`, whole `lodash`, `rxjs-compat` or `jquery` on the startup files that import them. None of them is graded, so the status-bar score is the same as before on the same code.

## 0.4.0

- Bundles ng-checkup 2.0.0. New findings show where they sit: accessibility defects and missing translation keys in the templates that have them, tests that assert nothing in their spec files, colours written outside the design tokens in the stylesheets, and `.subscribe()` calls nothing ends in their components. Translations and accessibility are never graded, so the status-bar score is the same as with 0.3.0 on the same code.

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
