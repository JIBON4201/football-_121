'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteMatchAction } from '@/app/control-center/matches/actions';

interface DeleteMatchButtonProps {
  id: string;
}

/** Two-step destructive action; the server action re-checks matches.delete and
 * surfaces the backend's 409 (match has dependents) as an inline error. */
export function DeleteMatchButton({ id }: DeleteMatchButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'pending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [, startTransition] = useTransition();

  const doDelete = () => {
    setPhase('pending');
    startTransition(async () => {
      const result = await deleteMatchAction(id);
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
      <span className="cc-confirm" role="group">
        <span className="cc-confirm__prompt">Delete this match?</span>
        <button type="button" className="cc-button cc-button--danger" onClick={doDelete} disabled={phase === 'pending'} aria-busy={phase === 'pending'}>
          {phase === 'pending' ? 'Deletingâ€¦' : 'Confirm'}
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
        <button type="button" className="cc-button cc-button--ghost" onClick={() => setPhase('idle')}>Dismiss</button>
      </span>
    );
  }

  return (
    <button type="button" className="cc-button cc-button--danger cc-button--sm" onClick={() => setPhase('confirm')}>
      Delete
    </button>
  );
}
