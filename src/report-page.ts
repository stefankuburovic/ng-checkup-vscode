/**
 * The report page with a Content-Security-Policy that allows its inline
 * styles and inline images and nothing else: no script, no remote request.
 * The report has neither, so this costs it nothing and keeps the webview
 * locked down if a future ng-checkup adds one.
 */
export function withContentSecurityPolicy(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;">`;
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n${policy}`) : `${policy}\n${html}`;
}
