import { z } from 'zod';
import {
  MATCH_STATUSES,
  TRANSFER_TYPES,
} from '../lib/validate';

export const PUBLIC_TRANSFER_STATUSES = ['rumour', 'announced', 'completed', 'cancelled', 'rejected'] as const;
const EVENT_TYPES = [
  'goal',
  'own_goal',
  'penalty_goal',
  'missed_penalty',
  'yellow_card',
  'red_card',
  'substitution',
  'var',
] as const;

const externalId = z.string().min(1).max(255);
const optionalName = z.string().min(1).max(200).optional();
const isoDateTime = z.string().datetime({ offset: true }).optional();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
  .optional();
const nonNegativeInt = z.number().int().min(0).optional();
const nonNegative = z.number().min(0).optional();
const percentage = z.number().min(0).max(100).optional();

export const NormalizedCountrySchema = z.object({
  externalId,
  name: z.string().min(1).max(150),
  code: z.string().regex(/^[A-Z]{2,3}$/).optional(),
});

export const NormalizedVenueSchema = z.object({
  externalId,
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  countryCode: z.string().regex(/^[A-Z]{2,3}$/).optional(),
  capacity: nonNegativeInt,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const NormalizedCompetitionSchema = z.object({
  externalId,
  name: z.string().min(1).max(150),
  shortName: z.string().max(80).optional(),
  countryCode: z.string().regex(/^[A-Z]{2,3}$/).optional(),
  type: z.string().max(30).optional(),
  gender: z.string().max(20).optional(),
});

export const NormalizedSeasonSchema = z.object({
  externalId,
  competitionExternalId: externalId,
  name: z.string().min(1).max(50),
  startDate: isoDate,
  endDate: isoDate,
});

export const NormalizedTeamSchema = z.object({
  externalId,
  name: z.string().min(1).max(150),
  shortName: z.string().max(80).optional(),
  countryCode: z.string().regex(/^[A-Z]{2,3}$/).optional(),
  logoUrl: z.string().url().max(500).optional(),
  foundedYear: z.number().int().min(1800).max(2100).optional(),
  venueExternalId: externalId.optional(),
  seasonExternalId: externalId.optional(),
  competitionExternalIds: z.array(externalId).max(20).optional(),
});

export const NormalizedPlayerSchema = z.object({
  externalId,
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  displayName: z.string().min(1).max(150),
  dateOfBirth: isoDate,
  nationalityCode: z.string().regex(/^[A-Z]{2,3}$/).optional(),
  position: z.string().max(40).optional(),
  preferredFoot: z.enum(['left', 'right', 'both']).optional(),
  heightCm: z.number().int().min(100).max(250).optional(),
  photoUrl: z.string().url().max(500).optional(),
  currentTeamExternalId: externalId.optional(),
});

export const NormalizedMatchSchema = z.object({
  externalId,
  competitionExternalId: externalId,
  seasonExternalId: externalId.optional(),
  venueExternalId: externalId.optional(),
  homeTeamExternalId: externalId,
  awayTeamExternalId: externalId,
  scheduledAt: z.string().datetime({ offset: true }),
  status: z.enum(MATCH_STATUSES),
  homeScore: z.number().int().min(0).optional(),
  awayScore: z.number().int().min(0).optional(),
  homeScoreHt: z.number().int().min(0).optional(),
  awayScoreHt: z.number().int().min(0).optional(),
  homeScoreEt: z.number().int().min(0).optional(),
  awayScoreEt: z.number().int().min(0).optional(),
  homeScorePen: z.number().int().min(0).optional(),
  awayScorePen: z.number().int().min(0).optional(),
  round: z.string().max(100).optional(),
  matchday: z.number().int().min(0).optional(),
});

export const NormalizedMatchEventSchema = z.object({
  matchExternalId: externalId,
  teamExternalId: externalId.optional(),
  playerExternalId: externalId.optional(),
  assistPlayerExternalId: externalId.optional(),
  type: z.enum(EVENT_TYPES),
  minute: z.number().int().min(0).max(200).optional(),
  extraMinute: z.number().int().min(0).max(60).optional(),
  description: z.string().max(2000).optional(),
});

export const NormalizedLineupSchema = z.object({
  matchExternalId: externalId,
  teamExternalId: externalId,
  formation: z.string().max(30).optional(),
  coachName: z.string().max(150).optional(),
  players: z
    .array(
      z.object({
        playerExternalId: externalId,
        position: z.string().max(30).optional(),
        shirtNumber: z.number().int().min(0).max(99).optional(),
        starter: z.boolean().optional(),
        captain: z.boolean().optional(),
        substitute: z.boolean().optional(),
        minutesPlayed: z.number().int().min(0).max(150).optional(),
      }),
    )
    .max(40),
});

const statFields = {
  shots: nonNegativeInt,
  shotsOnTarget: nonNegativeInt,
  corners: nonNegativeInt,
  fouls: nonNegativeInt,
  offsides: nonNegativeInt,
  yellowCards: nonNegativeInt,
  redCards: nonNegativeInt,
  passes: nonNegativeInt,
  passAccuracy: percentage,
};

export const NormalizedTeamStatisticsSchema = z.object({
  matchExternalId: externalId,
  teamExternalId: externalId,
  possession: percentage,
  ...statFields,
});

export const NormalizedPlayerStatisticsSchema = z.object({
  matchExternalId: externalId,
  teamExternalId: externalId,
  playerExternalId: externalId,
  minutes: z.number().int().min(0).max(150).optional(),
  goals: nonNegativeInt,
  assists: nonNegativeInt,
  tackles: nonNegativeInt,
  interceptions: nonNegativeInt,
  clearances: nonNegativeInt,
  rating: z.number().min(0).max(11).optional(),
  ...statFields,
});

export const NormalizedTransferSchema = z.object({
  externalId,
  playerExternalId: externalId,
  fromTeamExternalId: externalId.optional(),
  toTeamExternalId: externalId.optional(),
  transferType: z.enum(TRANSFER_TYPES),
  status: z.enum(PUBLIC_TRANSFER_STATUSES),
  fee: nonNegative,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  announcementDate: isoDateTime,
  effectiveDate: isoDateTime,
  seasonExternalId: externalId,
  windowName: z.string().max(150).optional(),
});

export type RecordErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_FORMAT'
  | 'INVALID_ENUM'
  | 'INVALID_DATE'
  | 'INVALID_RELATIONSHIP';

export interface RecordFailure {
  code: RecordErrorCode;
  message: string;
}

/** Validate one normalized record. Never throws — failures are returned. */
export function validateRecord<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): { ok: true; data: T } | { ok: false; failure: RecordFailure } {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  const code: RecordErrorCode = !first
    ? 'INVALID_FORMAT'
    : first.code === 'invalid_type'
      ? 'MISSING_FIELD'
      : (first.code as string) === 'invalid_enum_value' || (first.code as string) === 'invalid_enum'
        ? 'INVALID_ENUM'
        : 'INVALID_FORMAT';
  return {
    ok: false,
    failure: {
      code,
      message: first ? `${String(first.path.join('.') || 'record')}: ${first.message}`.slice(0, 500) : 'Invalid record',
    },
  };
}
