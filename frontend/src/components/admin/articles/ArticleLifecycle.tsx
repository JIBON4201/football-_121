'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { transitionArticleAction, type ArticleFormState } from '@/app/control-center/articles/actions';

const IDLE: ArticleFormState = {};

interface Props {
  id: string;
  status: string;
  canPublish: boolean;
  canUpdate: boolean;
}

function Action({ label, verb }: { label: string; verb: 'submit' | 'publish' | 'archive' | 'restore' | 'unpublish' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="verb"
      value={verb}
      disabled={pending}
      className="cc-button cc-button--ghost cc-button--sm"
      onClick={(e) => {
        // Keep a hidden input per form instead of relying on button value.
        const f = e.currentTarget.form;
        if (f) {
          const h = f.querySelector<HTMLInputElement>('input[name="verb"]');
          if (h) h.value = verb;
        }
      }}
    >
      {pending ? '…' : label}
    </button>
  );
}

export function ArticleLifecycle({ id, status, canPublish, canUpdate }: Props) {
  const [state, formAction] = useFormState(
    async (_prev: ArticleFormState, formData: FormData): Promise<ArticleFormState> => {
      const verb = String(formData.get('verb') ?? '') as 'submit' | 'publish' | 'archive' | 'restore' | 'unpublish' | 'schedule';
      if (!verb) return { error: 'Choose an action.' };
      return transitionArticleAction(id, verb);
    },
    IDLE,
  );

  return (
    <form action={formAction} className="cc-actions">
      <input type="hidden" name="verb" value="" />
      {status === 'draft' && canUpdate ? <Action label="Submit for review" verb="submit" /> : null}
      {status === 'review' && canPublish ? <Action label="Publish" verb="publish" /> : null}
      {status === 'scheduled' && canPublish ? <Action label="Unpublish" verb="unpublish" /> : null}
      {status === 'published' && canPublish ? <Action label="Unpublish" verb="unpublish" /> : null}
      {(status === 'published' || status === 'scheduled' || status === 'review' || status === 'draft') && canUpdate ? (
        <Action label="Archive" verb="archive" />
      ) : null}
      {status === 'archived' && canUpdate ? <Action label="Restore to draft" verb="restore" /> : null}
      {state.error ? <p role="alert" className="cc-muted">{state.error}</p> : null}
      {state.success ? <p role="status" className="cc-muted">{state.success}</p> : null}
    </form>
  );
}
