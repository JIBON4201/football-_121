'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { useFormStatus } from 'react-dom';
import { createArticleAction, updateArticleAction, type ArticleFormState } from '@/app/control-center/articles/actions';
import type { PublicCategoryRow } from '@/lib/admin/article-query';
import type { AdminArticleEditorial } from '@/types/api';

const ARTICLE_TYPES = ['news', 'breaking_news', 'transfer', 'match_report', 'analysis', 'opinion'] as const;

const TYPE_LABELS: Record<string, string> = {
  news: 'News',
  breaking_news: 'Breaking news',
  transfer: 'Transfer',
  match_report: 'Match report',
  analysis: 'Analysis',
  opinion: 'Opinion',
};

interface ArticleFormProps {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminArticleEditorial;
  categories: PublicCategoryRow[];
  /** True when redirected from create (?created=1) — shows a success banner. */
  wasCreated?: boolean;
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
      {pending ? (mode === 'create' ? 'Creating…' : 'Saving…') : mode === 'create' ? 'Create article' : 'Save changes'}
    </button>
  );
}

/**
 * Client-side mirror of the server validation rules. The server action
 * re-runs the same checks, so this is UX only — never the source of truth.
 */
function validateFields(values: { title: string; content: string; articleType: string; excerpt: string; slug: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.title.trim().length < 5) errors.title = 'Title must be at least 5 characters.';
  if (values.title.trim().length > 300) errors.title = 'Title must be 300 characters or fewer.';
  if (!ARTICLE_TYPES.includes(values.articleType as never)) errors.articleType = 'Choose a valid article type.';
  if (values.excerpt.trim().length > 2000) errors.excerpt = 'Excerpt must be 2000 characters or fewer.';
  if (values.content.trim().length < 20) errors.content = 'Content must be at least 20 characters.';
  if (values.slug.trim() && !/^[A-Za-z0-9_.-]+$/.test(values.slug.trim())) errors.slug = 'Slug may only contain letters, numbers, "-", "_" and ".".';
  return errors;
}

export function ArticleForm({ mode, id, initial, categories, wasCreated }: ArticleFormProps) {
  const action = mode === 'create' ? createArticleAction : updateArticleAction.bind(null, id!);
  const [state, formAction] = useFormState(action, {} as ArticleFormState);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const values = {
      title: String((form.elements.namedItem('title') as HTMLInputElement)?.value ?? ''),
      content: String((form.elements.namedItem('content') as HTMLTextAreaElement)?.value ?? ''),
      articleType: String((form.elements.namedItem('articleType') as HTMLSelectElement)?.value ?? ''),
      excerpt: String((form.elements.namedItem('excerpt') as HTMLTextAreaElement)?.value ?? ''),
      slug: String((form.elements.namedItem('slug') as HTMLInputElement)?.value ?? ''),
    };
    const errors = validateFields(values);
    if (Object.keys(errors).length > 0) {
      event.preventDefault();
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
  };

  const mergedErrors = { ...state.fields, ...fieldErrors };
  const showSuccess = state.success || wasCreated;

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="cc-form" noValidate>
      {showSuccess ? (
        <p className="cc-alert cc-alert--success" role="status">
          {state.success ?? 'Article created.'}
        </p>
      ) : null}
      {state.error ? (
        <p className="cc-alert" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="cc-field">
        <label htmlFor="article-title">Title *</label>
        <input id="article-title" name="title" type="text" required maxLength={300} defaultValue={initial?.title ?? ''} aria-invalid={Boolean(mergedErrors.title)} />
        {mergedErrors.title ? <p className="cc-field__error">{mergedErrors.title}</p> : null}
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="article-type">Type *</label>
          <select id="article-type" name="articleType" defaultValue={initial?.article_type ?? 'news'}>
            {ARTICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {mergedErrors.articleType ? <p className="cc-field__error">{mergedErrors.articleType}</p> : null}
        </div>

        <div className="cc-field">
          <label htmlFor="article-slug">Slug</label>
          <input id="article-slug" name="slug" type="text" defaultValue={initial?.slug ?? ''} placeholder="auto-generated if blank" aria-invalid={Boolean(mergedErrors.slug)} />
          {mergedErrors.slug ? <p className="cc-field__error">{mergedErrors.slug}</p> : null}
        </div>
      </div>

      <div className="cc-field">
        <label htmlFor="article-excerpt">Excerpt</label>
        <textarea id="article-excerpt" name="excerpt" rows={3} maxLength={2000} defaultValue={initial?.excerpt ?? ''} aria-invalid={Boolean(mergedErrors.excerpt)} />
        {mergedErrors.excerpt ? <p className="cc-field__error">{mergedErrors.excerpt}</p> : null}
      </div>

      <div className="cc-field">
        <label htmlFor="article-content">Content *</label>
        <textarea id="article-content" name="content" rows={14} defaultValue={initial?.content ?? ''} required aria-invalid={Boolean(mergedErrors.content)} />
        <p className="cc-field__hint">Minimum 20 characters. HTML is allowed.</p>
        {mergedErrors.content ? <p className="cc-field__error">{mergedErrors.content}</p> : null}
      </div>

      {mode === 'create' && categories.length > 0 ? (
        <fieldset className="cc-field cc-checkboxes">
          <legend>Categories</legend>
          {categories.map((c) => (
            <label key={c.id} className="cc-checkbox">
              <input type="checkbox" name="categoryIds" value={c.id} />
              <span>{c.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="cc-field cc-checkboxes--row">
        <label className="cc-checkbox">
          <input type="checkbox" name="isFeatured" defaultChecked={initial?.is_featured ?? false} />
          <span>Featured article</span>
        </label>
        <label className="cc-checkbox">
          <input type="checkbox" name="isBreaking" defaultChecked={initial?.is_breaking ?? false} />
          <span>Breaking news</span>
        </label>
      </div>
      <p className="cc-field__hint">Breaking news pairs with the “Breaking news” type on the backend.</p>

      <div className="cc-form__actions">
        <SubmitButton mode={mode} />
        <Link href="/control-center/articles" className="cc-button cc-button--ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
