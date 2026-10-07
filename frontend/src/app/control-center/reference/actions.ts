'use server';

/**
 * Server actions for the reference modules (team, player, competition, season,
 * venue).
 *
 * One exported action per entity rather than a generic `save(resource, values)`
 * helper. That is deliberate: the resource, the required permission and the
 * revalidation fan-out are all fixed inside the action body, so a caller cannot
 * reach an entity it lacks permission for by passing a different name. The
 * backend re-checks the same permission regardless — this only avoids the round
 * trip and gives the operator a clear message.
 *
 * Flow for every action: session → permission → typed coercion → backend →
 * revalidate public caches → redirect.
 */
import { redirect } from 'next/navigation';
import { adminFailureMessage } from '@/lib/admin/resource';
import { revalidatePublic } from '@/lib/admin/revalidate';
import {
  adminCompetitions,
  adminSettings,
  adminPlayers,
  adminSeasons,
  adminTeams,
  adminVenues,
  type AdminResult,
} from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export interface ReferenceFormState {
  error?: string;
  fields?: Record<string, string>;
}

/** Gate shared by every action: valid session plus the named permission. */
async function requirePermission(permission: string, action: string): Promise<ReferenceFormState | null> {
  const session = await getAdminSession();
  if (session.status !== 'ok') {
    return { error: 'Your session has expired. Please sign in again.' };
  }
  if (!session.user.permissions.includes(permission)) {
    return { error: `You do not have permission to ${action}.` };
  }
  return null;
}

/** Collapse an `AdminResult` into the flat shape the form renders. */
function toFormState(result: AdminResult<unknown>): ReferenceFormState {
  if (result.status === 'ok') return {};
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  return { error: adminFailureMessage(result) };
}

type Values = Record<string, string | number | boolean | null>;

function req(values: Values, key: string): string {
  return str(values, key) ?? '';
}

function str(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nullableStr(values: Values, key: string): string | null {
  const value = values[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableNum(values: Values, key: string): number | null {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(values: Values, key: string): boolean | undefined {
  const value = values[key];
  return typeof value === 'boolean' ? value : undefined;
}

/* ── Teams ────────────────────────────────────────────────────────────────── */

export async function saveTeamAction(id: string | null, values: Values): Promise<ReferenceFormState> {
  const gate = await requirePermission(id ? 'teams.update' : 'teams.create', id ? 'edit teams' : 'create teams');
  if (gate) return gate;

  const body = {
    name: req(values, 'name'),
    short_name: nullableStr(values, 'short_name'),
    slug: str(values, 'slug'),
    country_id: nullableStr(values, 'country_id'),
    logo_url: nullableStr(values, 'logo_url'),
    venue_id: nullableStr(values, 'venue_id'),
    website_url: nullableStr(values, 'website_url'),
    founded_year: nullableNum(values, 'founded_year'),
    is_active: bool(values, 'is_active'),
  };

  const result = id ? await adminTeams.update(id, body) : await adminTeams.create(body);
  const state = toFormState(result);
  if (state.error) return state;
  if (result.status !== 'ok') return { error: 'The team could not be saved.' };

  revalidatePublic('teams', { paths: [`/teams/${result.data.slug}`] });
  redirect('/control-center/teams');
}

export async function deleteTeamAction(id: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('teams.delete', 'delete teams');
  if (gate) return gate;
  const state = toFormState(await adminTeams.remove(id));
  if (state.error) return state;
  revalidatePublic('teams');
  return {};
}

/* ── Players ─────────────────────────────────────────────────────────────── */

export async function savePlayerAction(id: string | null, values: Values): Promise<ReferenceFormState> {
  const gate = await requirePermission(id ? 'players.update' : 'players.create', id ? 'edit players' : 'create players');
  if (gate) return gate;

  const body = {
    display_name: req(values, 'display_name'),
    first_name: nullableStr(values, 'first_name'),
    last_name: nullableStr(values, 'last_name'),
    slug: str(values, 'slug'),
    nationality_id: nullableStr(values, 'nationality_id'),
    position: nullableStr(values, 'position'),
    preferred_foot: nullableStr(values, 'preferred_foot'),
    photo_url: nullableStr(values, 'photo_url'),
    status: nullableStr(values, 'status'),
    date_of_birth: nullableStr(values, 'date_of_birth'),
    height_cm: nullableNum(values, 'height_cm'),
  };

  const result = id ? await adminPlayers.update(id, body) : await adminPlayers.create(body);
  const state = toFormState(result);
  if (state.error) return state;
  if (result.status !== 'ok') return { error: 'The player could not be saved.' };

  revalidatePublic('players', { paths: [`/players/${result.data.slug}`] });
  redirect('/control-center/players');
}

export async function deletePlayerAction(id: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('players.delete', 'delete players');
  if (gate) return gate;
  const state = toFormState(await adminPlayers.remove(id));
  if (state.error) return state;
  revalidatePublic('players');
  return {};
}

/* ── Competitions ────────────────────────────────────────────────────────── */

export async function saveCompetitionAction(id: string | null, values: Values): Promise<ReferenceFormState> {
  const gate = await requirePermission(
    id ? 'competitions.update' : 'competitions.create',
    id ? 'edit competitions' : 'create competitions',
  );
  if (gate) return gate;

  const body = {
    name: req(values, 'name'),
    short_name: nullableStr(values, 'short_name'),
    slug: str(values, 'slug'),
    country_id: nullableStr(values, 'country_id'),
    logo_url: nullableStr(values, 'logo_url'),
    type: nullableStr(values, 'type'),
    gender: nullableStr(values, 'gender'),
    is_active: bool(values, 'is_active'),
  };

  const result = id ? await adminCompetitions.update(id, body) : await adminCompetitions.create(body);
  const state = toFormState(result);
  if (state.error) return state;
  if (result.status !== 'ok') return { error: 'The competition could not be saved.' };

  revalidatePublic('competitions', { paths: [`/competitions/${result.data.slug}`] });
  redirect('/control-center/competitions');
}

export async function deleteCompetitionAction(id: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('competitions.delete', 'delete competitions');
  if (gate) return gate;
  const state = toFormState(await adminCompetitions.remove(id));
  if (state.error) return state;
  revalidatePublic('competitions');
  return {};
}

/* ── Seasons ─────────────────────────────────────────────────────────────── */

export async function saveSeasonAction(id: string | null, values: Values): Promise<ReferenceFormState> {
  const gate = await requirePermission(id ? 'seasons.manage' : 'seasons.manage', id ? 'edit seasons' : 'create seasons');
  if (gate) return gate;

  const body = {
    competition_id: req(values, 'competition_id'),
    name: req(values, 'name'),
    start_date: nullableStr(values, 'start_date'),
    end_date: nullableStr(values, 'end_date'),
    is_current: bool(values, 'is_current'),
  };

  const result = id ? await adminSeasons.update(id, body) : await adminSeasons.create(body);
  const state = toFormState(result);
  if (state.error) return state;
  if (result.status !== 'ok') return { error: 'The season could not be saved.' };

  // Seasons have no public page of their own; they surface on competition and
  // team routes, which the competitions fan-out already covers.
  revalidatePublic('seasons');
  redirect('/control-center/seasons');
}

export async function deleteSeasonAction(id: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('seasons.manage', 'delete seasons');
  if (gate) return gate;
  const state = toFormState(await adminSeasons.remove(id));
  if (state.error) return state;
  revalidatePublic('seasons');
  return {};
}

/* Venues ------------------------------------------------------------------- */

/**
 * Save one `system_settings` row.
 *
 * The backend stores `jsonb`, so a scalar is sent as a JSON string and a value
 * that already looks like JSON/array/object is passed through. Parse failures
 * are reported rather than silently stored as a string.
 */
export async function saveSettingAction(key: string, raw: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('settings.manage', 'change settings');
  if (gate) return gate;

  const trimmed = raw.trim();
  const looksStructured = trimmed.startsWith('{') || trimmed.startsWith('[');
  let value: unknown = trimmed;
  if (looksStructured) {
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { error: `"${key}" must be valid JSON.`, fields: { value: 'Invalid JSON.' } };
    }
  }

  const state = toFormState(await adminSettings.update(key, value));
  if (state.error) return state;
  // Settings feed site metadata (name, logo, contact) which the public layout
  // reads; purge the surfaces that embed it.
  revalidatePublic('media', { paths: ['/', '/news', '/matches'] });
  return {};
}

export async function saveVenueAction(id: string | null, values: Values): Promise<ReferenceFormState> {
  const gate = await requirePermission(id ? 'venues.manage' : 'venues.manage', id ? 'edit venues' : 'create venues');
  if (gate) return gate;

  const body = {
    name: req(values, 'name'),
    slug: str(values, 'slug'),
    city: nullableStr(values, 'city'),
    country_id: nullableStr(values, 'country_id'),
    image_url: nullableStr(values, 'image_url'),
    capacity: nullableNum(values, 'capacity'),
    latitude: nullableNum(values, 'latitude'),
    longitude: nullableNum(values, 'longitude'),
  };

  const result = id ? await adminVenues.update(id, body) : await adminVenues.create(body);
  const state = toFormState(result);
  if (state.error) return state;
  if (result.status !== 'ok') return { error: 'The venue could not be saved.' };

  revalidatePublic('venues');
  redirect('/control-center/venues');
}

export async function deleteVenueAction(id: string): Promise<ReferenceFormState> {
  const gate = await requirePermission('venues.manage', 'delete venues');
  if (gate) return gate;
  const state = toFormState(await adminVenues.remove(id));
  if (state.error) return state;
  revalidatePublic('venues');
  return {};
}