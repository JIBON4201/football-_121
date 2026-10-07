'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState } from 'react-dom';
import { useFormStatus } from 'react-dom';
import { createMatchAction, updateMatchAction, type MatchFormState } from '@/app/control-center/matches/actions';
import type { OptionRow } from '@/lib/admin/options-shared';
import type { AdminMatchDetail } from '@/types/api';
import { MATCH_STATUSES } from '@/types/api';

interface MatchFormProps {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminMatchDetail;
  teams: OptionRow[];
  competitions: OptionRow[];
  seasons: OptionRow[];
  venues: OptionRow[];
  wasCreated?: boolean;
}

function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
      {pending ? (mode === 'create' ? 'Creating…' : 'Saving…') : mode === 'create' ? 'Create match' : 'Save changes'}
    </button>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client-side mirror of the server rules; the action is authoritative. */
function validateFields(v: { competition_id: string; home_team_id: string; away_team_id: string; scheduled_at: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!UUID.test(v.competition_id)) e.competition_id = 'Choose a competition.';
  if (!UUID.test(v.home_team_id)) e.home_team_id = 'Choose a home team.';
  if (!UUID.test(v.away_team_id)) e.away_team_id = 'Choose an away team.';
  if (v.home_team_id && v.away_team_id && v.home_team_id === v.away_team_id) e.away_team_id = 'Home and away teams must differ.';
  if (!v.scheduled_at || Number.isNaN(Date.parse(v.scheduled_at))) e.scheduled_at = 'Choose a valid kickoff date/time.';
  return e;
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MatchForm({ mode, id, initial, teams, competitions, seasons, venues, wasCreated }: MatchFormProps) {
  const action = mode === 'create' ? createMatchAction : updateMatchAction.bind(null, id!);
  const [state, formAction] = useFormState(action, {} as MatchFormState);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    const get = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement)?.value ?? '');
    const errors = validateFields({ competition_id: get('competition_id'), home_team_id: get('home_team_id'), away_team_id: get('away_team_id'), scheduled_at: get('scheduled_at') });
    if (Object.keys(errors).length > 0) {
      event.preventDefault();
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
  };

  const merged = { ...state.fields, ...fieldErrors };

  return (
    <form action={formAction} onSubmit={handleSubmit} className="cc-form" noValidate>
      {(state.success || wasCreated) ? <p className="cc-alert cc-alert--success" role="status">{state.success ?? 'Match created.'}</p> : null}
      {state.error ? <p className="cc-alert" role="alert">{state.error}</p> : null}

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-home">Home team *</label>
          <select id="m-home" name="home_team_id" defaultValue={initial?.home_team_id ?? ''}>
            <option value="">Select…</option>
            {teams.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </select>
          {merged.home_team_id ? <p className="cc-field__error">{merged.home_team_id}</p> : null}
        </div>
        <div className="cc-field">
          <label htmlFor="m-away">Away team *</label>
          <select id="m-away" name="away_team_id" defaultValue={initial?.away_team_id ?? ''}>
            <option value="">Select…</option>
            {teams.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </select>
          {merged.away_team_id ? <p className="cc-field__error">{merged.away_team_id}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-comp">Competition *</label>
          <select id="m-comp" name="competition_id" defaultValue={initial?.competition_id ?? ''}>
            <option value="">Select…</option>
            {competitions.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </select>
          {merged.competition_id ? <p className="cc-field__error">{merged.competition_id}</p> : null}
        </div>
        <div className="cc-field">
          <label htmlFor="m-kickoff">Kickoff *</label>
          <input id="m-kickoff" name="scheduled_at" type="datetime-local" defaultValue={toLocalInput(initial?.scheduled_at)} />
          {merged.scheduled_at ? <p className="cc-field__error">{merged.scheduled_at}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-season">Season</label>
          <select id="m-season" name="season_id" defaultValue={initial?.season_id ?? ''}>
            <option value="">None</option>
            {seasons.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </select>
          {seasons.length === 0 ? <p className="cc-field__hint">No seasons loaded (seasons.read may be missing).</p> : null}
        </div>
        <div className="cc-field">
          <label htmlFor="m-venue">Venue</label>
          <select id="m-venue" name="venue_id" defaultValue={initial?.venue_id ?? ''}>
            <option value="">None</option>
            {venues.map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
          </select>
          {venues.length === 0 ? <p className="cc-field__hint">No venues loaded (venues.read may be missing).</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-status">Status</label>
          <select id="m-status" name="status" defaultValue={initial?.status ?? ''}>
            <option value="">Default (scheduled)</option>
            {MATCH_STATUSES.map((s) => (<option key={s} value={s}>{s.replace('_', ' ')}</option>))}
          </select>
          {merged.status ? <p className="cc-field__error">{merged.status}</p> : null}
        </div>
        <div className="cc-field">
          <label htmlFor="m-slug">Slug</label>
          <input id="m-slug" name="slug" type="text" defaultValue={initial?.slug ?? ''} placeholder="auto from team slugs" />
          {merged.slug ? <p className="cc-field__error">{merged.slug}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-round">Round</label>
          <input id="m-round" name="round" type="text" defaultValue={initial?.round ?? ''} />
        </div>
        <div className="cc-field">
          <label htmlFor="m-matchday">Matchday</label>
          <input id="m-matchday" name="matchday" type="number" min="0" defaultValue={initial?.matchday ?? ''} />
          {merged.matchday ? <p className="cc-field__error">{merged.matchday}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-referee">Referee</label>
          <input id="m-referee" name="referee_name" type="text" defaultValue={initial?.referee_name ?? ''} />
        </div>
        <div className="cc-field">
          <label htmlFor="m-attendance">Attendance</label>
          <input id="m-attendance" name="attendance" type="number" min="0" defaultValue={initial?.attendance ?? ''} />
          {merged.attendance ? <p className="cc-field__error">{merged.attendance}</p> : null}
        </div>
      </div>

      <div className="cc-grid-2">
        <div className="cc-field">
          <label htmlFor="m-hs">Home score</label>
          <input id="m-hs" name="home_score" type="number" min="0" defaultValue={initial?.home_score ?? ''} />
          {merged.home_score ? <p className="cc-field__error">{merged.home_score}</p> : null}
        </div>
        <div className="cc-field">
          <label htmlFor="m-as">Away score</label>
          <input id="m-as" name="away_score" type="number" min="0" defaultValue={initial?.away_score ?? ''} />
          {merged.away_score ? <p className="cc-field__error">{merged.away_score}</p> : null}
        </div>
      </div>

      <div className="cc-form__actions">
        <SubmitButton mode={mode} />
        <Link href="/control-center/matches" className="cc-button cc-button--ghost">Cancel</Link>
      </div>
    </form>
  );
}
