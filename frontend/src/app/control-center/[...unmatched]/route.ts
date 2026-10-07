/**
 * Unmatched Admin URLs (e.g. /control-center/nope): a real 404 with none of the
 * public site chrome.
 *
 * A route handler rather than a page, for one reason: the root `loading.tsx`
 * streams its shell immediately, which commits a 200 before a page-level
 * `notFound()` can run. Handling the match here keeps the status honest and
 * lets the Admin 404 stay visually separate from the public 404.
 */
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET(request: Request): Response {
  const url = new URL(request.url);
  let shownPath = url.pathname;
  try {
    shownPath = decodeURIComponent(url.pathname);
  } catch {
    /* keep the raw path when it is not valid percent-encoding */
  }
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex, nofollow">` +
      `<title>Not found · Control Center</title></head>` +
      `<body><div class="cc-root"><main id="main-content" class="cc-denied">` +
      `<h1>Section not found</h1>` +
      `<p>${escape(shownPath)} is not a Control Center section.</p>` +
      `<p><a href="/control-center/dashboard">Back to dashboard</a></p>` +
      `</main></div></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } },
  );
}