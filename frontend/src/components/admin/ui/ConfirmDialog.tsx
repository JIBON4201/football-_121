'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AdminIcon } from './AdminIcon';
import { AdminButton } from './AdminButton';

/**
 * Accessible confirmation dialog for destructive actions.
 *
 * Replaces the previous inline "are you sure?" row, which could not be
 * dismissed with Escape, had no dialog semantics, and shifted the table layout
 * when it appeared.
 *
 * Accessibility: role="alertdialog" + aria-modal, labelled by its own title and
 * described by its own message, focus moved in on open and restored on close,
 * Tab trapped inside, Escape cancels. Pending state disables both buttons so a
 * double submit is impossible.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What exactly is about to happen, in plain language. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) setPendingError(null);
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !pending) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="cc-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="cc-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cc-dialog-title"
        aria-describedby="cc-dialog-message"
        onKeyDown={handleKeyDown}
      >
        <div className="cc-dialog__head">
          <span className="cc-dialog__icon">
            <AdminIcon name="alert" size={17} />
          </span>
          <h2 className="cc-dialog__title" id="cc-dialog-title">
            {title}
          </h2>
        </div>
        <div className="cc-dialog__body">
          <p className="cc-dialog__message" id="cc-dialog-message">
            {message}
          </p>
          {error ?? pendingError ? (
            <p className="cc-alert cc-dialog__error" role="alert">
              {error ?? pendingError}
            </p>
          ) : null}
        </div>
        <div className="cc-dialog__foot">
          <AdminButton variant="ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </AdminButton>
          <AdminButton
            ref={confirmRef}
            variant="solid-danger"
            icon="trash"
            loading={pending}
            loadingLabel={confirmLabel}
            onClick={() => {
              setPendingError(null);
              onConfirm();
            }}
          >
            {pending ? `${confirmLabel}…` : confirmLabel}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

/**
 * Trigger + dialog pair for a destructive row action.
 *
 * Keeps the per-row footprint to a single icon button, so a table of deletes no
 * longer widens every row while nothing is pending.
 *
 * `action` must be a *server action reference*, typically a bound action such as
 * `deleteArticleAction.bind(null, id)` — never an inline arrow function. These
 * tables are Server Components (only the control itself is client-side), and
 * React refuses to serialize a closure across that boundary; a bound `'use
 * server'` export is a serializable reference and works. Passing a closure here
 * fails the render with "Event handlers cannot be passed to Client Component
 * props" and the surrounding table silently collapses into its error boundary.
 */
export function ConfirmAction({
  label,
  message,
  action,
  icon = 'trash',
  disabled = false,
}: {
  /** Accessible name, e.g. "Delete article". */
  label: string;
  message: string;
  /** Server action reference, usually pre-bound to the row id. */
  action: () => Promise<{ error?: string } | void> | { error?: string } | void;
  icon?: 'trash' | 'alert';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      // Server actions report failures in-band rather than throwing, because the
      // action layer already maps every status onto a message for the operator.
      if (result && typeof result === 'object' && typeof result.error === 'string' && result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      // The row is gone; pull the fresh server-rendered list rather than
      // patching local state, so the table reflects the backend exactly.
      router.refresh();
    } catch {
      setError('The action could not be completed. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <AdminButton
        variant="ghost"
        size="sm"
        icon={icon}
        iconOnly
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        title={label}
        message={message}
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={run}
      />
    </>
  );
}