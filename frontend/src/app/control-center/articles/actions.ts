'use server';

import { redirect } from 'next/navigation';
import { createAdminArticle, deleteAdminArticle, updateAdminArticle, type ArticleResult } from '@/lib/admin/articles';
import { createApiClient } from '@/lib/api-client';
import { revalidatePublic } from '@/lib/admin/revalidate';
import { adminFailureMessage, toAdminError } from '@/lib/admin/resource';
import { getAdminSession, getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';
import type { AdminArticleEditorial } from '@/types/api';

/**
 * Step 18 — server actions for the articles module.
 *
 * Validation is lightweight here (the backend is the authority): the client
 * form does its own required/length checks first, and these actions re-check
 * the same rules so an empty or hostile FormData never hits the API.
 * Every action fails closed on an unexpected shape.
 */

export interface ArticleFormState {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
}

const ARTICLE_TYPES = ['news', 'breaking_news', 'transfer', 'match_report', 'analysis', 'opinion'] as const;

function validationError(fields: Record<string, string>): ArticleFormState {
  return { error: 'Please fix the highlighted fields.', fields };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateArticleForm(formData: FormData): { error?: ArticleFormState; values?: { title: string; articleType: string; slug?: string; excerpt?: string; content: string; isFeatured: boolean; isBreaking: boolean; categoryIds?: string[] } } {
  const title = str(formData.get('title'));
  const content = str(formData.get('content'));
  const articleType = str(formData.get('articleType'));
  const slug = str(formData.get('slug'));
  const excerpt = str(formData.get('excerpt'));
  const isFeatured = formData.get('isFeatured') === 'on';
  const isBreaking = formData.get('isBreaking') === 'on';

  const fields: Record<string, string> = {};
  if (title.length < 5) fields.title = 'Title must be at least 5 characters.';
  if (title.length > 300) fields.title = 'Title must be 300 characters or fewer.';
  if (!ARTICLE_TYPES.includes(articleType as never)) fields.articleType = 'Choose a valid article type.';
  if (excerpt.length > 2000) fields.excerpt = 'Excerpt must be 2000 characters or fewer.';
  if (content.length < 20) fields.content = 'Content must be at least 20 characters.';
  if (content.length > 200_000) fields.content = 'Content is too long.';
  if (slug && !/^[A-Za-z0-9_.-]+$/.test(slug)) fields.slug = 'Slug may only contain letters, numbers, "-", "_" and ".".';

  if (Object.keys(fields).length > 0) {
    return { error: validationError(fields) };
  }
  return {
    values: {
      title,
      articleType,
      slug: slug || undefined,
      excerpt: excerpt || undefined,
      content,
      isFeatured,
      isBreaking,
      categoryIds: formData.getAll('categoryIds').map(String).filter(Boolean),
    },
  };
}

export async function createArticleAction(_prev: ArticleFormState, formData: FormData): Promise<ArticleFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') {
    return { error: 'Your session has expired. Please sign in again.' };
  }
  if (!session.user.permissions.includes('articles.create')) {
    return { error: 'You do not have permission to create articles.' };
  }

  const check = validateArticleForm(formData);
  if (check.error) return check.error;
  const values = check.values!;

  const result = await createAdminArticle({
    title: values.title,
    articleType: values.articleType,
    content: values.content,
    slug: values.slug,
    excerpt: values.excerpt,
    isFeatured: values.isFeatured,
    isBreaking: values.isBreaking,
    categoryIds: values.categoryIds && values.categoryIds.length > 0 ? values.categoryIds : undefined,
  });
if (result.status === 'forbidden') return { error: 'You do not have permission to create articles.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'A referenced record no longer exists.' };
  if (result.status === 'conflict') return { error: result.message };
  // Surface per-field detail and rate-limit guidance exactly as `update` does —
  // a bare "Could not create" banner hides which field the backend rejected.
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status === 'rate-limited') {
    const wait = result.retryAfterSeconds ? ` Try again in ${result.retryAfterSeconds}s.` : '';
    return { error: `${result.message}${wait}` };
  }
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  // Only after the backend confirms the write: invalidating on failure would
  // cost a public refetch for a change that never happened.
  revalidatePublic('articles', { paths: [`/news/${result.article.slug}`] });
  redirect(`/control-center/articles/${result.article.id}/edit?created=1`);
}

export async function updateArticleAction(id: string, _prev: ArticleFormState, formData: FormData): Promise<ArticleFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') {
    return { error: 'Your session has expired. Please sign in again.' };
  }
  if (!session.user.permissions.includes('articles.update')) {
    return { error: 'You do not have permission to edit articles.' };
  }

  const check = validateArticleForm(formData);
  if (check.error) return check.error;
  const values = check.values!;

  const result = await updateAdminArticle(id, {
    title: values.title,
    articleType: values.articleType,
    content: values.content,
    slug: values.slug,
    excerpt: values.excerpt === undefined ? undefined : values.excerpt,
    isFeatured: values.isFeatured,
    isBreaking: values.isBreaking,
  });
  if (result.status !== 'ok') {
    if (result.status === 'forbidden') return { error: 'You do not have permission to edit this article.' };
    if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
    if (result.status === 'not-found') return { error: 'This article no longer exists.' };
    if (result.status === 'invalid') return { error: result.message, fields: result.fields };
    return { error: result.message };
  }
  // Purges the public article route plus every feed that lists articles, so an
  // edit is visible immediately instead of after the longest revalidate window.
  // A slug change leaves the previous URL to the backend's redirect table, which
  // `revalidatePath('/news')` above already re-reads.
  revalidatePublic('articles', { paths: [`/news/${result.article.slug}`] });
  return { success: 'Changes saved.' };
}

async function postArticleLifecycle(id: string, verb: string, body?: unknown): Promise<ArticleResult> {
  try {
    const envelope = await createApiClient({
      baseUrl: siteConfig.apiUrl,
      getToken: () => getAdminAccessToken() ?? null,
    }).request<AdminArticleEditorial>(`/admin/articles/${encodeURIComponent(id)}/${verb}`, {
      method: 'POST',
      body,
    });
    const article = envelope?.data;
    if (!article || typeof article.id !== 'string') return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', article };
  } catch (error) {
    return toAdminError(error, 'Request failed');
  }
}

async function transitionArticle(id: string, verb: 'submit' | 'publish' | 'schedule' | 'archive' | 'restore' | 'unpublish', scheduledAt?: string): Promise<ArticleFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') return { error: 'Your session has expired. Please sign in again.' };
  const needed: Record<string, string[]> = {
    publish: ['articles.publish'],
    schedule: ['articles.publish'],
    unpublish: ['articles.publish'],
    submit: ['articles.update'],
    archive: ['articles.update'],
    restore: ['articles.update'],
  };
  if (!needed[verb].every((p) => session.user.permissions.includes(p))) {
    return { error: `You do not have permission to ${verb} articles.` };
  }
  const result = await postArticleLifecycle(id, verb, verb === 'schedule' ? { scheduledAt } : undefined);
  const PAST: Record<string, string> = { submit: 'submitted', publish: 'published', schedule: 'scheduled', archive: 'archived', restore: 'restored', unpublish: 'unpublished' };
  if (result.status === 'ok') {
    revalidatePublic('articles', { paths: [`/news/${result.article.slug}`] });
    return { success: `Article ${PAST[verb]}.` };
  }
  if (result.status === 'forbidden') return { error: `You do not have permission to ${verb} articles.` };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'This article no longer exists.' };
  if (result.status === 'conflict' || result.status === 'invalid') return { error: result.message };
  return { error: 'Lifecycle change failed.' };
}

export async function transitionArticleAction(id: string, verb: 'submit' | 'publish' | 'schedule' | 'archive' | 'restore' | 'unpublish', scheduledAt?: string): Promise<ArticleFormState> {
  return transitionArticle(id, verb, scheduledAt);
}

export async function deleteArticleAction(id: string): Promise<ArticleFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') {
    return { error: 'Your session has expired. Please sign in again.' };
  }
  if (!session.user.permissions.includes('articles.delete')) {
    return { error: 'You do not have permission to delete articles.' };
  }
  const result = await deleteAdminArticle(id);
  if (result.status === 'forbidden') return { error: 'You are not allowed to delete this article. Published articles may require an admin role.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'conflict') return { error: result.message };
  if (result.status === 'not-found') return { error: 'This article no longer exists.' };
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  revalidatePublic('articles');
  return { success: 'Article deleted.' };
}
