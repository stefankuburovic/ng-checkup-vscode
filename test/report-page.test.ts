import { withContentSecurityPolicy } from '../src/report-page.js';

describe('withContentSecurityPolicy', () => {
  it('puts the policy first in the head, so it applies before any style', () => {
    const page = withContentSecurityPolicy('<!doctype html><html><head><meta charset="utf-8"><style>p{}</style></head><body></body></html>');
    expect(page.indexOf('Content-Security-Policy')).toBeLessThan(page.indexOf('<style>'));
    expect(page).toContain("default-src 'none'");
    expect(page).not.toContain('script-src');
  });

  it('still adds the policy to a page without a head', () => {
    expect(withContentSecurityPolicy('<p>x</p>')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
  });
});
