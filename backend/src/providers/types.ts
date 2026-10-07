/**
 * Normalized provider DTOs. Adapters convert provider-specific responses
 * into these structures; the rest of the application never sees raw
 * provider payloads. Absent values are `undefined` (never trust blanks).
 */

export interface NormalizedCountry {
  externalId: string;
  name: string;
  code?: string;
}

export interface NormalizedVenue {
  externalId: string;
  name: string;
  city?: string;
  countryCode?: string;
  capacity?: number;
  latitude?: number;
  longitude?: number;
}

export interface NormalizedCompetition {
  externalId: string;
  name: string;
  shortName?: string;
  countryCode?: string;
  type?: string;
  gender?: string;
}

export interface NormalizedSeason {
  externalId: string;
  competitionExternalId: string;
  name: string;
  startDate?: string;
  endDate?: string;
}

export interface NormalizedTeam {
  externalId: string;
  name: string;
  shortName?: string;
  countryCode?: string;
  logoUrl?: string;
  foundedYear?: number;
  venueExternalId?: string;
  /** Optional season context for team-competition links. */
  seasonExternalId?: string;
  /** Competitions this team takes part in (canonical links, no copies). */
  competitionExternalIds?: string[];
}

export interface NormalizedPlayer {
  externalId: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  dateOfBirth?: string;
  nationalityCode?: string;
  position?: string;
  preferredFoot?: string;
  heightCm?: number;
  photoUrl?: string;
  currentTeamExternalId?: string;
}

export type NormalizedMatchStatus =
  | 'scheduled'
  | 'pre_match'
  | 'live'
  | 'half_time'
  | 'extra_time'
  | 'penalty_shootout'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'abandoned'
  | 'suspended';

export interface NormalizedMatch {
  externalId: string;
  competitionExternalId: string;
  seasonExternalId?: string;
  venueExternalId?: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  scheduledAt: string;
  status: NormalizedMatchStatus;
  homeScore?: number;
  awayScore?: number;
  homeScoreHt?: number;
  awayScoreHt?: number;
  homeScoreEt?: number;
  awayScoreEt?: number;
  homeScorePen?: number;
  awayScorePen?: number;
  round?: string;
  matchday?: number;
  refereeName?: string;
}

export type NormalizedEventType =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'missed_penalty'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'
  | 'var';

export interface NormalizedMatchEvent {
  matchExternalId: string;
  teamExternalId?: string;
  playerExternalId?: string;
  assistPlayerExternalId?: string;
  type: NormalizedEventType;
  minute?: number;
  extraMinute?: number;
  description?: string;
}

export interface NormalizedLineupPlayer {
  playerExternalId: string;
  position?: string;
  shirtNumber?: number;
  starter?: boolean;
  captain?: boolean;
  substitute?: boolean;
  minutesPlayed?: number;
}

export interface NormalizedLineup {
  matchExternalId: string;
  teamExternalId: string;
  formation?: string;
  coachName?: string;
  players: NormalizedLineupPlayer[];
}

export interface NormalizedTeamStatistics {
  matchExternalId: string;
  teamExternalId: string;
  possession?: number;
  shots?: number;
  shotsOnTarget?: number;
  corners?: number;
  fouls?: number;
  offsides?: number;
  yellowCards?: number;
  redCards?: number;
  passes?: number;
  passAccuracy?: number;
  /** Provider extras with no dedicated column (zone splits, penalties, xG + provenance). */
  metadata?: Record<string, unknown>;
}

export interface NormalizedPlayerStatistics {
  matchExternalId: string;
  teamExternalId: string;
  playerExternalId: string;
  minutes?: number;
  goals?: number;
  assists?: number;
  shots?: number;
  shotsOnTarget?: number;
  passes?: number;
  passAccuracy?: number;
  tackles?: number;
  interceptions?: number;
  clearances?: number;
  yellowCards?: number;
  redCards?: number;
  rating?: number;
  /** Provider extras with no dedicated column (duels, dribbles, saves, …). */
  metadata?: Record<string, unknown>;
}

export type NormalizedTransferType = 'permanent' | 'loan' | 'loan_return' | 'free_transfer';
export type NormalizedTransferStatus = 'rumour' | 'announced' | 'completed' | 'cancelled' | 'rejected';

export interface NormalizedTransfer {
  externalId: string;
  playerExternalId: string;
  fromTeamExternalId?: string;
  toTeamExternalId?: string;
  transferType: NormalizedTransferType;
  status: NormalizedTransferStatus;
  fee?: number;
  currency?: string;
  announcementDate?: string;
  effectiveDate?: string;
  seasonExternalId: string;
  windowName?: string;
}

export type SyncEntityType =
  | 'countries'
  | 'venues'
  | 'competitions'
  | 'seasons'
  | 'teams'
  | 'players'
  | 'matches'
  | 'events'
  | 'lineups'
  | 'team-stats'
  | 'player-stats'
  | 'transfers';

/** Discoverable provider capabilities — no operation is assumed. */
export type ProviderCapabilities = Record<SyncEntityType, boolean>;
