'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { AdminButton, type AdminButtonVariant } from './ui/AdminButton';

/**
 * Generic destructive row action.
 *
 * The reference modules all need the same control: an icon button that opens a
 * confirmation dialog, calls a real server action, shows the backend's refusal
 * (usually a 409 about dependent rows) inline, and refreshes the server-rendered
 * table on success. Writing it once keeps that behaviour identical everywhere.
 *
 * `action` must be a server action reference — bind the row id at the call site
 * (`deleteTeamAction.bind(null, id)`). An inline arrow function cannot cross the
 * Server/Client boundary and fails the render.
 */
export function ConfirmDeleteButton({
  id,
  label,
  entity,
  consequence,
  action,
  variant = 'ghost',
}: {
  id: string;
  /** Accessible name including the entity, e.g. `Delete Eastvale City`. */
  label: string;
  /** Human noun used in the dialog copy, e.g. "team". */
  entity: string;
  /** What the operator should know before confirming. */
  consequence: string;
  action: () => Promise<{ error?: string }>;
  variant?: AdminButtonVariant;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = `cc-confirm-${id}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        setOpen(false);
        setError(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending]);

  function confirm() {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setError(null);
      // The row is gone; re-read the server-rendered list rather than patching
      // local state, so the table matches the backend exactly.
      router.refresh();
    });
  }

  return (
    <>
      <AdminButton
        variant={variant}
        size="sm"
        icon="trash"
        iconOnly
        aria-label={label}
        title={label}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      />
      {open ? (
        <div className="cc-dialog-backdrop" onClick={() => !pending && setOpen(false)}>
          <div
            className="cc-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event: React.MouseEvent) => event.stopPropagation()}
          >
            <div className="cc-dialog__head">
              <h2 className="cc-dialog__title" id={titleId}>
                Delete {label.replace(/^Delete\s+/i, '')}?
              </h2>
            </div>
            <div className="cc-dialog__body">
              <p className="cc-dialog__message">{consequence}</p>
              {error ? (
                <p className="cc-dialog__error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="cc-dialog__foot">
              <button type="button" className="cc-button cc-button--primary" onClick={confirm} disabled={pending}>
                {pending ? 'Deleting…' : `Delete ${entity}`}
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

/** Wraps the per-row action cluster so list pages stay declarative. */
export function RowActions({ children }: { children: ReactNode }) {
  return <span className="cc-row-actions">{children}</span>;
}