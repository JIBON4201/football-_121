'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { ConfirmDialog } from '@/components/admin/ui/ConfirmDialog';
import { AdminButton } from '@/components/admin/ui/AdminButton';
import { deleteEventAction } from '@/app/control-center/matches/actions';
import { useState } from 'react';

interface DeleteEventButtonProps {
  matchId: string;
  eventId: string;
}

/** Two-step destructive action; the server action re-checks match_events.manage. */
export function DeleteEventButton({ matchId, eventId }: DeleteEventButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const doDelete = () => {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result = await deleteEventAction(matchId, eventId);
      setPending(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <AdminButton variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete
      </AdminButton>
      <ConfirmDialog
        open={open}
        title="Delete event"
        message="Delete this match event? This cannot be undone."
        confirmLabel="Delete"
        pending={pending}
        error={error}
        onConfirm={doDelete}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
