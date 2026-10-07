import { isValidPartitionFile, proxyBackendSitemap } from '@/lib/sitemap-proxy';

/**
 * `/sitemaps/<partition>.xml` — sitemap partitions on the public origin.
 *
 * The backend index advertises exactly these paths, so the documents must be
 * reachable here. Unknown filenames are a real 404 rather than a proxied error.
 */
export const revalidate = 3600;

export async function GET(
  _request: Request,
  context: { params: { file: string } },
): Promise<Response> {
  const { file } = context.params;
  if (!isValidPartitionFile(file)) {
    return new Response(null, { status: 404 });
  }
  const page = new URL(_request.url).searchParams.get('page') ?? '1';
  if (!/^\d+$/.test(page) || Number(page) < 1) {
    return new Response(null, { status: 404 });
  }
  const suffix = page === '1' ? '' : `?page=${encodeURIComponent(page)}`;
  return proxyBackendSitemap(`/sitemaps/${file}${suffix}`);
}