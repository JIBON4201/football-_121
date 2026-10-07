'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteArticleAction } from '@/app/control-center/articles/actions';

interface DeleteArticleButtonProps {
  id: string;
  title: string;
}

/**
 * Two-step destructive action: a deliberate confirm state before the API call.
 * Server action re-checks the articles.delete permission; the UI only ever
 * gates visibility, never the outcome.
 */
export function DeleteArticleButton({ id, title }: DeleteArticleButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'pending' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [, startTransition] = useTransition();

  const doDelete = () => {
    setPhase('pending');
    startTransition(async () => {
      const result = await deleteArticleAction(id);
      if (result.error) {
        setMessage(result.error);
        setPhase('error');
        return;
      }
      setPhase('idle');
      router.refresh();
    });
  };

  if (phase === 'confirm' || phase === 'pending') {
    return (
      <span className="cc-confirm" role="group" aria-label={`Confirm deletion of ${title}`}>
        <span className="cc-confirm__prompt">Delete â€œ{title}â€?</span>
        <button type="button" className="cc-button cc-button--danger" onClick={doDelete} disabled={phase === 'pending'} aria-busy={phase === 'pending'}>
          {phase === 'pending' ? 'Deletingâ€¦' : 'Confirm delete'}
        </button>
        <button type="button" className="cc-button cc-button--ghost" onClick={() => setPhase('idle')} disabled={phase === 'pending'}>
          Cancel
        </button>
      </span>
    );
  }

  if (phase === 'error') {
    return (
      <span className="cc-confirm" role="alert">
        <span className="cc-confirm__error">{message}</span>
        <button type="button" className="cc-button cc-button--ghost" onClick={() => setPhase('idle')}>
          Dismiss
        </button>
      </span>
    );
  }

  return (
    <button type="button" className="cc-button cc-button--danger cc-button--sm" onClick={() => setPhase('confirm')}>
      Delete
    </button>
  );
}
