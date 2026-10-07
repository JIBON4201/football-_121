'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { deleteTeamAction } from '@/app/control-center/reference/actions';
import { AdminButton } from '@/components/admin/ui/AdminButton';

/**
 * Delete control for the teams table.
 *
 * Calls the real `deleteTeamAction` server action, which re-checks the
 * `teams.delete` permission and surfaces the backend's 409 when the team still
 * has dependants (matches, history, transfers). A conflict is shown inside the
 * dialog rather than collapsed into a generic failure, because "deactivate
 * instead" is the actionable next step.
 *
 * Rendering is gated by the parent on `teams.delete`, but the backend remains the
 * authority — hiding a control is convenience, not authorization.
 */
export function DeleteTeamButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Escape closes, matching the shared ConfirmDialog behaviour.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setError(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function confirm() {
    startTransition(async () => {
      const result = await deleteTeamAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setError(null);
      router.refresh();
    });
  }

  return (
    <>
      <AdminButton
        variant="ghost"
        size="sm"
        icon="trash"
        iconOnly
        aria-label={`Delete ${name}`}
        title={`Delete ${name}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="cc-dialog-backdrop" onClick={() => setOpen(false)}>
          {/* stopPropagation: a click inside the dialog must not dismiss it. */}
          <div
            className="cc-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`cc-del-team-${id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cc-dialog__head">
              <h2 className="cc-dialog__title" id={`cc-del-team-${id}`}>
                Delete “{name}”?
              </h2>
            </div>
            <div className="cc-dialog__body">
              <p className="cc-dialog__message">
                Teams with matches, history or transfers cannot be deleted — set the team inactive instead.
              </p>
              {error ? (
                <p className="cc-dialog__error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="cc-dialog__foot">
              <button type="button" className="cc-button cc-button--primary" onClick={confirm} disabled={pending}>
                {pending ? 'Deleting…' : 'Delete team'}
              </button>
              <button
                type="button"
                className="cc-button cc-button--ghost"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}