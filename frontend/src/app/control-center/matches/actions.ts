'use server';

import { redirect } from 'next/navigation';
import { revalidatePublic } from '@/lib/admin/revalidate';
import {
  createAdminMatch,
  createMatchEvent,
  deleteAdminMatch,
  deleteMatchEvent,
  updateAdminMatch,
  updateMatchEvent,
} from '@/lib/admin/matches';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';
import {
  MATCH_EVENT_TYPES,
  MATCH_STATUSES,
  type AdminMatchCreateInput,
  type AdminMatchEventCreateInput,
} from '@/types/api';

/**
 * Step 20 — server actions for matches + events. Client validates for UX; these
 * re-check rules and the permission set; the backend remains authoritative.
 * Match delete is SAFE on the backend (409 when dependents exist) — the error
 * message is surfaced rather than hidden.
 */
export interface MatchFormState {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function intOrNull(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function toIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validateMatchForm(fd: FormData): { error?: MatchFormState; values?: AdminMatchCreateInput } {
  const competition_id = str(fd.get('competition_id'));
  const home_team_id = str(fd.get('home_team_id'));
  const away_team_id = str(fd.get('away_team_id'));
  const season_id = str(fd.get('season_id'));
  const venue_id = str(fd.get('venue_id'));
  const scheduled_at = str(fd.get('scheduled_at'));
  const status = str(fd.get('status'));
  const slug = str(fd.get('slug'));
  const round = str(fd.get('round'));
  const matchday = str(fd.get('matchday'));
  const referee_name = str(fd.get('referee_name'));
  const attendance = str(fd.get('attendance'));
  const home_score = str(fd.get('home_score'));
  const away_score = str(fd.get('away_score'));

  const fields: Record<string, string> = {};
  if (!UUID.test(competition_id)) fields.competition_id = 'Choose a competition.';
  if (!UUID.test(home_team_id)) fields.home_team_id = 'Choose a home team.';
  if (!UUID.test(away_team_id)) fields.away_team_id = 'Choose an away team.';
  if (home_team_id && away_team_id && home_team_id === away_team_id) fields.away_team_id = 'Home and away teams must differ.';
  if (season_id && !UUID.test(season_id)) fields.season_id = 'Choose a valid season.';
  if (venue_id && !UUID.test(venue_id)) fields.venue_id = 'Choose a valid venue.';
  if (!scheduled_at || Number.isNaN(Date.parse(scheduled_at))) fields.scheduled_at = 'Choose a valid kickoff date/time.';
  if (status && !(MATCH_STATUSES as readonly string[]).includes(status)) fields.status = 'Invalid status.';
  if (slug && !/^[A-Za-z0-9_.-]+$/.test(slug)) fields.slug = 'Slug may contain letters, numbers, "-", "_" and ".".';
  if (matchday && (Number.isNaN(Number(matchday)) || Number(matchday) < 0)) fields.matchday = 'Matchday must be a non-negative number.';
  if (attendance && (Number.isNaN(Number(attendance)) || Number(attendance) < 0)) fields.attendance = 'Attendance must be a non-negative number.';
  if (home_score && !/^\d+$/.test(home_score)) fields.home_score = 'Home score must be a non-negative integer.';
  if (away_score && !/^\d+$/.test(away_score)) fields.away_score = 'Away score must be a non-negative integer.';

  if (Object.keys(fields).length > 0) return { error: { error: 'Please fix the highlighted fields.', fields } };

  return {
    values: {
      competition_id,
      home_team_id,
      away_team_id,
      season_id: season_id || null,
      venue_id: venue_id || null,
      scheduled_at: toIso(scheduled_at) as string,
      status: status || undefined,
      slug: slug || undefined,
      round: round || null,
      matchday: matchday ? Number(matchday) : null,
      referee_name: referee_name || null,
      attendance: attendance ? Number(attendance) : null,
      home_score: intOrNull(home_score),
      away_score: intOrNull(away_score),
    },
  };
}

async function requirePerm(permission: string): Promise<{ error: string } | null> {
  const session = await getAdminSession();
  if (session.status !== 'ok') return { error: 'Your session has expired. Please sign in again.' };
  if (!session.user.permissions.includes(permission)) return { error: `You do not have permission for this action (${permission}).` };
  return null;
}

export async function createMatchAction(_prev: MatchFormState, fd: FormData): Promise<MatchFormState> {
  const gate = await requirePerm('matches.create');
  if (gate) return { error: gate.error };
  const check = validateMatchForm(fd);
  if (check.error) return check.error;
  const result = await createAdminMatch(check.values!);
if (result.status === 'forbidden') return { error: 'You do not have permission to create matches.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'A referenced record no longer exists.' };
  if (result.status === 'conflict') return { error: result.message };
  // Same detail as `update`: a generic banner would hide which field the
  // backend rejected (e.g. a foreign key that no longer resolves).
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status === 'rate-limited') {
    const wait = result.retryAfterSeconds ? ` Try again in ${result.retryAfterSeconds}s.` : '';
    return { error: `${result.message}${wait}` };
  }
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  revalidatePublic('matches', { matchSlug: result.match.slug });
  redirect(`/control-center/matches/${result.match.id}/edit?created=1`);
}

export async function updateMatchAction(id: string, _prev: MatchFormState, fd: FormData): Promise<MatchFormState> {
  const gate = await requirePerm('matches.update');
  if (gate) return { error: gate.error };
  const check = validateMatchForm(fd);
  if (check.error) return check.error;
  const v = check.values!;
  const result = await updateAdminMatch(id, v);
  if (result.status === 'forbidden') return { error: 'You do not have permission to edit this match.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
if (result.status === 'not-found') return { error: 'This match no longer exists.' };
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  // Score and status edits are the highest-visibility change in the product —
  // the live banner, match centre and homepage all read this row.
  revalidatePublic('matches', { matchSlug: result.match.slug });
  return { success: 'Changes saved.' };
}

export async function deleteMatchAction(id: string): Promise<MatchFormState> {
  const gate = await requirePerm('matches.delete');
  if (gate) return { error: gate.error };
const result = await deleteAdminMatch(id);
  if (result.status === 'ok') {
    revalidatePublic('matches');
    return { success: 'Match deleted.' };
  }
  if (result.status === 'forbidden') return { error: 'You are not allowed to delete this match.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  // The backend returns a descriptive 409 when the match has dependents.
  if (result.status === 'conflict') return { error: result.message };
  if (result.status === 'not-found') return { error: 'This match no longer exists.' };
  return { error: result.message };
}

const EVENT_TYPE_SET = new Set(MATCH_EVENT_TYPES as readonly string[]);

function validateEventForm(fd: FormData): { error?: MatchFormState; values?: AdminMatchEventCreateInput } {
  const type = str(fd.get('type'));
  const team_id = str(fd.get('team_id'));
  const player_id = str(fd.get('player_id'));
  const assist_player_id = str(fd.get('assist_player_id'));
  const minute = str(fd.get('minute'));
  const extra_minute = str(fd.get('extra_minute'));
  const description = str(fd.get('description'));

  const fields: Record<string, string> = {};
  if (!EVENT_TYPE_SET.has(type)) fields.type = 'Choose a valid event type.';
  for (const [key, val] of Object.entries({ team_id, player_id, assist_player_id })) {
    if (val && !UUID.test(val)) fields[key] = 'Choose a valid option.';
  }
  if (minute !== '' && (Number.isNaN(Number(minute)) || Number(minute) < 0)) fields.minute = 'Minute must be a non-negative number.';
  if (extra_minute !== '' && (Number.isNaN(Number(extra_minute)) || Number(extra_minute) < 0)) fields.extra_minute = 'Extra minute must be a non-negative number.';
  if (description.length > 5000) fields.description = 'Description is too long.';

  if (Object.keys(fields).length > 0) return { error: { error: 'Please fix the highlighted fields.', fields } };

  return {
    values: {
      type,
      team_id: team_id || null,
      player_id: player_id || null,
      assist_player_id: assist_player_id || null,
      minute: minute === '' ? null : Number(minute),
      extra_minute: extra_minute === '' ? null : Number(extra_minute),
      description: description || null,
    },
  };
}

export async function createEventAction(matchId: string, _prev: MatchFormState, fd: FormData): Promise<MatchFormState> {
  const gate = await requirePerm('match_events.manage');
  if (gate) return { error: gate.error };
  const check = validateEventForm(fd);
  if (check.error) return check.error;
  const result = await createMatchEvent(matchId, check.values!);
  if (result.status === 'forbidden') return { error: 'You do not have permission to manage match events.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status !== 'ok') return { error: result.status === 'error' ? result.message : 'The event could not be added.' };
  // The event form does not carry the match slug, so the whole match surface is
  // purged rather than one tagged detail fetch.
  revalidatePublic('matches');
  return { success: 'Event added.' };
}

export async function updateEventAction(matchId: string, eventId: string, _prev: MatchFormState, fd: FormData): Promise<MatchFormState> {
  const gate = await requirePerm('match_events.manage');
  if (gate) return { error: gate.error };
  const check = validateEventForm(fd);
  if (check.error) return check.error;
  const result = await updateMatchEvent(matchId, eventId, check.values!);
  if (result.status === 'forbidden') return { error: 'You do not have permission to manage match events.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'This event no longer exists.' };
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status !== 'ok') return { error: result.status === 'error' ? result.message : 'The event could not be updated.' };
  revalidatePublic('matches');
  return { success: 'Event updated.' };
}

export async function deleteEventAction(matchId: string, eventId: string): Promise<MatchFormState> {
  const gate = await requirePerm('match_events.manage');
  if (gate) return { error: gate.error };
  const result = await deleteMatchEvent(matchId, eventId);
  if (result.status === 'ok') {
    revalidatePublic('matches');
    return { success: 'Event deleted.' };
  }
  if (result.status === 'forbidden') return { error: 'You are not allowed to delete this event.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'This event no longer exists.' };
  return { error: result.message };
}
