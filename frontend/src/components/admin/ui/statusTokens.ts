/**
 * Status vocabulary for the Control Center.
 *
 * Every key here is a REAL backend enum member, read from the Postgres enums in
 * supabase/migrations. Nothing is inferred or invented — an unrecognised value
 * renders in the neutral tone rather than being force-fitted into a semantic
 * colour it might contradict.
 *
 *   user_status      active | suspended | deleted
 *   article_status   draft | review | scheduled | published | archived
 *   match_status     scheduled | pre_match | live | half_time | extra_time |
 *                    penalty_shootout | finished | postponed | cancelled |
 *                    abandoned | suspended
 *   transfer_status  rumour | announced | completed | cancelled | rejected
 *   sync_status      queued | running | completed | partial | failed
 */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live';

type ToneMap = Record<string, StatusTone>;

const TONES: ToneMap = {
  // user_status
  active: 'success',
  suspended: 'warning',
  deleted: 'danger',

  // article_status
  draft: 'neutral',
  review: 'warning',
  scheduled: 'info',
  published: 'success',
  archived: 'neutral',

  // match_status
  pre_match: 'info',
  live: 'live',
  half_time: 'live',
  extra_time: 'live',
  penalty_shootout: 'live',
  finished: 'neutral',
  postponed: 'warning',
  cancelled: 'danger',
  abandoned: 'danger',

  // transfer_status
  rumour: 'warning',
  announced: 'info',
  completed: 'success',
  rejected: 'danger',

  // sync_status
  queued: 'neutral',
  running: 'info',
  partial: 'warning',
  failed: 'danger',
};

export function statusTone(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

/** `penalty_shootout` -> `Penalty shootout`. */
export function formatStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}