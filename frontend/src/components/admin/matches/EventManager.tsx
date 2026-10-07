'use client';

import { useState } from 'react';
import { DeleteEventButton } from './DeleteEventButton';
import { EventForm } from './EventForm';
import { EmptyState } from '@/components/admin/ui/Feedback';
import { RefCell } from '@/components/admin/RefCell';
import type { OptionRow } from '@/lib/admin/options-shared';
import type { AdminMatchEvent } from '@/types/api';

interface EventManagerProps {
  matchId: string;
  events: AdminMatchEvent[];
  teams: OptionRow[];
  players: OptionRow[];
}

const TYPE_EMOJI: Record<string, string> = {
  goal: 'âš½',
  own_goal: 'âš½',
  penalty_goal: 'âš½',
  missed_penalty: 'âœ•',
  yellow_card: 'ðŸŸ¨',
  red_card: 'ðŸŸ¥',
  substitution: 'ðŸ”„',
  var: 'ðŸ“º',
};

function fmtMinute(minute: number | null, extra: number | null): string {
  if (minute === null) return 'â€”';
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

/** Match event list + create/edit/delete, inline. Data is server-refreshed by
 * each action; this component only holds UI state (which row is being edited). */
export function EventManager({ matchId, events, teams, players }: EventManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="cc-event-manager">
      <h3 className="cc-panel__title">Events</h3>

      <EventForm matchId={matchId} teams={teams} players={players} />

      {events.length === 0 ? (
        <EmptyState title="No events recorded" description="Add goals, cards and substitutions for this match." />
      ) : (
        <ul className="cc-event-list">
          {events.map((ev) => (
            <li key={ev.id} className="cc-event-row">
              {editingId === ev.id ? (
                <EventForm
                  matchId={matchId}
                  event={ev}
                  teams={teams}
                  players={players}
                  onDone={() => setEditingId(null)}
                />
              ) : (
                <div className="cc-event-row__main">
                  <span className="cc-event-row__type">
                    {TYPE_EMOJI[ev.type] ?? 'â€¢'} {ev.type.replace(/_/g, ' ')}
                  </span>
                  <span className="cc-dt">{fmtMinute(ev.minute, ev.extra_minute)}</span>
                  <span className="cc-muted">team</span> <RefCell id={ev.team_id} />
                  {ev.description ? <span className="cc-muted">â€” {ev.description}</span> : null}
                  <span className="cc-row-actions">
                    <button type="button" className="cc-button cc-button--ghost cc-button--sm" onClick={() => setEditingId(ev.id)}>
                      Edit
                    </button>
                    <DeleteEventButton matchId={matchId} eventId={ev.id} />
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
