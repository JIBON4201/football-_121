'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { useFormStatus } from 'react-dom';
import {
  createEventAction,
  updateEventAction,
  type MatchFormState,
} from '@/app/control-center/matches/actions';
import type { OptionRow } from '@/lib/admin/options-shared';
import type { AdminMatchEvent } from '@/types/api';
import { MATCH_EVENT_TYPES } from '@/types/api';

interface EventFormProps {
  matchId: string;
  /** Present in edit mode; absent for create. */
  event?: AdminMatchEvent;
  teams: OptionRow[];
  players: OptionRow[];
  /** Collapse/cancel handler used after a successful save. */
  onDone?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  goal: 'Goal',
  own_goal: 'Own goal',
  penalty_goal: 'Penalty goal',
  missed_penalty: 'Missed penalty',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
  var: 'VAR',
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cc-button cc-button--primary cc-button--sm" disabled={pending} aria-busy={pending}>
      {pending ? 'Savingâ€¦' : label}
    </button>
  );
}

export function EventForm({ matchId, event, teams, players, onDone }: EventFormProps) {
  const router = useRouter();
  const isEdit = Boolean(event);
  const action = isEdit
    ? updateEventAction.bind(null, matchId, event!.id)
    : createEventAction.bind(null, matchId);
  const [state, formAction] = useFormState(action, {} as MatchFormState);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onDone?.();
    }
  }, [state.success, router, onDone]);

  return (
    <form action={formAction} className="cc-form cc-event-form" noValidate>
      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor={`ev-type-${event?.id ?? 'new'}`}>Type *</label>
          <select id={`ev-type-${event?.id ?? 'new'}`} name="type" defaultValue={event?.type ?? 'goal'}>
            {MATCH_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor={`ev-minute-${event?.id ?? 'new'}`}>Minute</label>
          <input id={`ev-minute-${event?.id ?? 'new'}`} name="minute" type="number" min="0" defaultValue={event?.minute ?? ''} />
        </div>
      </div>
      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor={`ev-extra-${event?.id ?? 'new'}`}>Extra minute</label>
          <input id={`ev-extra-${event?.id ?? 'new'}`} name="extra_minute" type="number" min="0" defaultValue={event?.extra_minute ?? ''} />
        </div>
        <div className="cc-field">
          <label htmlFor={`ev-team-${event?.id ?? 'new'}`}>Team</label>
          <select id={`ev-team-${event?.id ?? 'new'}`} name="team_id" defaultValue={event?.team_id ?? ''}>
            <option value="">None</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor={`ev-player-${event?.id ?? 'new'}`}>Player</label>
          <select id={`ev-player-${event?.id ?? 'new'}`} name="player_id" defaultValue={event?.player_id ?? ''}>
            <option value="">None</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor={`ev-assist-${event?.id ?? 'new'}`}>Assist player</label>
          <select id={`ev-assist-${event?.id ?? 'new'}`} name="assist_player_id" defaultValue={event?.assist_player_id ?? ''}>
            <option value="">None</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="cc-field">
        <label htmlFor={`ev-desc-${event?.id ?? 'new'}`}>Description</label>
        <textarea id={`ev-desc-${event?.id ?? 'new'}`} name="description" rows={2} maxLength={5000} defaultValue={event?.description ?? ''} />
      </div>
      {state.error ? <p className="cc-alert" role="alert">{state.error}</p> : null}
      {state.success ? <p className="cc-alert cc-alert--success" role="status">{state.success}</p> : null}
      <div className="cc-form__actions">
        <Submit label={isEdit ? 'Save event' : 'Add event'} />
        {isEdit && onDone ? (
          <button type="button" className="cc-button cc-button--ghost" onClick={onDone}>Cancel</button>
        ) : null}
      </div>
    </form>
  );
}
