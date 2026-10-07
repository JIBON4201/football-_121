'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { useFormStatus } from 'react-dom';
import { createTransferAction, updateTransferAction, type TransferFormState } from '@/app/control-center/transfers/actions';
import type { OptionRow } from '@/lib/admin/options-shared';
import type { AdminTransferDetail } from '@/types/api';
import { ADMIN_TRANSFER_STATUSES, ADMIN_TRANSFER_TYPES } from '@/types/api';

const TYPE_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  loan: 'Loan',
  loan_return: 'Loan return',
  free_transfer: 'Free transfer',
};

interface TransferFormProps {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminTransferDetail;
  players: OptionRow[];
  teams: OptionRow[];
  windows: OptionRow[];
  seasons: OptionRow[];
  wasCreated?: boolean;
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
      {pending ? (mode === 'create' ? 'Creating…' : 'Saving…') : mode === 'create' ? 'Create transfer' : 'Save changes'}
    </button>
  );
}

/** Client-side mirror of the server rules; the server action is authoritative. */
function validateForm(values: {
  player_id: string;
  season_id: string;
  transfer_type: string;
  from_team_id: string;
  to_team_id: string;
  fee: string;
  currency: string;
  announcement_date: string;
  effective_date: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(values.player_id)) errors.player_id = 'Choose a player.';
  if (!UUID.test(values.season_id)) errors.season_id = 'Choose a season.';
  if (!(ADMIN_TRANSFER_TYPES as readonly string[]).includes(values.transfer_type)) errors.transfer_type = 'Choose a valid transfer type.';
  if (values.from_team_id && values.to_team_id && values.from_team_id === values.to_team_id) errors.to_team_id = 'From and to teams must differ.';
  if (values.fee && (Number.isNaN(Number(values.fee)) || Number(values.fee) < 0)) errors.fee = 'Fee must be a non-negative number.';
  if (values.currency && !/^[A-Z]{3}$/.test(values.currency)) errors.currency = 'Currency must be a 3-letter uppercase code.';
  if (values.announcement_date && Number.isNaN(Date.parse(values.announcement_date))) errors.announcement_date = 'Invalid announcement date.';
  if (values.effective_date && Number.isNaN(Date.parse(values.effective_date))) errors.effective_date = 'Invalid effective date.';
  if (values.announcement_date && values.effective_date && Date.parse(values.effective_date) < Date.parse(values.announcement_date)) {
    errors.effective_date = 'Effective date must be on or after the announcement date.';
  }
  return errors;
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TransferForm({ mode, id, initial, players, teams, windows, seasons, wasCreated }: TransferFormProps) {
  const action = mode === 'create' ? createTransferAction : updateTransferAction.bind(null, id!);
  const [state, formAction] = useFormState(action, {} as TransferFormState);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const get = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement)?.value ?? '');
    const errors = validateForm({
      player_id: get('player_id'),
      season_id: get('season_id'),
      transfer_type: get('transfer_type'),
      from_team_id: get('from_team_id'),
      to_team_id: get('to_team_id'),
      fee: get('fee'),
      currency: get('currency'),
      announcement_date: get('announcement_date'),
      effective_date: get('effective_date'),
    });
    if (Object.keys(errors).length > 0) {
      event.preventDefault();
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
  };

  const merged = { ...state.fields, ...fieldErrors };
  const showSuccess = state.success || wasCreated;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="cc-form" noValidate>
      {showSuccess ? <p className="cc-alert cc-alert--success" role="status">{state.success ?? 'Transfer created.'}</p> : null}
      {state.error ? <p className="cc-alert" role="alert">{state.error}</p> : null}

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="t-player">Player *</label>
          <select id="t-player" name="player_id" defaultValue={initial?.player_id ?? ''}>
            <option value="">Select a player…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {merged.player_id ? <p className="cc-field__error">{merged.player_id}</p> : null}
        </div>

        <div className="cc-field">
          <label htmlFor="t-season">Season *</label>
          <select id="t-season" name="season_id" defaultValue={initial?.season_id ?? ''}>
            <option value="">Select a season…</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          {merged.season_id ? <p className="cc-field__error">{merged.season_id}</p> : null}
          {seasons.length === 0 ? <p className="cc-field__hint">No seasons loaded — you may need the seasons.read permission.</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="t-type">Transfer type *</label>
          <select id="t-type" name="transfer_type" defaultValue={initial?.transfer_type ?? 'permanent'}>
            {ADMIN_TRANSFER_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          {merged.transfer_type ? <p className="cc-field__error">{merged.transfer_type}</p> : null}
        </div>

        <div className="cc-field">
          <label htmlFor="t-status">Status</label>
          <select id="t-status" name="status" defaultValue={initial?.status ?? ''}>
            <option value="">Default (rumour)</option>
            {ADMIN_TRANSFER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {merged.status ? <p className="cc-field__error">{merged.status}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="t-from">From team</label>
          <select id="t-from" name="from_team_id" defaultValue={initial?.from_team_id ?? ''}>
            <option value="">None</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {merged.from_team_id ? <p className="cc-field__error">{merged.from_team_id}</p> : null}
        </div>

        <div className="cc-field">
          <label htmlFor="t-to">To team</label>
          <select id="t-to" name="to_team_id" defaultValue={initial?.to_team_id ?? ''}>
            <option value="">None</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {merged.to_team_id ? <p className="cc-field__error">{merged.to_team_id}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="t-window">Transfer window</label>
          <select id="t-window" name="window_id" defaultValue={initial?.window_id ?? ''}>
            <option value="">None</option>
            {windows.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="t-fee">Fee</label>
          <input id="t-fee" name="fee" type="number" min="0" step="any" defaultValue={initial?.fee ?? ''} placeholder="e.g. 5000000" />
          {merged.fee ? <p className="cc-field__error">{merged.fee}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="t-currency">Currency</label>
          <input id="t-currency" name="currency" type="text" maxLength={3} defaultValue={initial?.currency ?? ''} placeholder="EUR" />
          {merged.currency ? <p className="cc-field__error">{merged.currency}</p> : null}
        </div>

        <div className="cc-field">
          <label htmlFor="t-announcement">Announcement date</label>
          <input id="t-announcement" name="announcement_date" type="datetime-local" defaultValue={toLocalInput(initial?.announcement_date)} />
          {merged.announcement_date ? <p className="cc-field__error">{merged.announcement_date}</p> : null}
        </div>
      </div>

      <div className="cc-field">
        <label htmlFor="t-effective">Effective date</label>
        <input id="t-effective" name="effective_date" type="datetime-local" defaultValue={toLocalInput(initial?.effective_date)} />
        {merged.effective_date ? <p className="cc-field__error">{merged.effective_date}</p> : null}
      </div>

      <div className="cc-form__actions">
        <SubmitButton mode={mode} />
        <Link href="/control-center/transfers" className="cc-button cc-button--ghost">Cancel</Link>
      </div>
    </form>
  );
}
