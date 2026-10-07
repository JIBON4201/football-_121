import type {
  NormalizedCompetition,
  NormalizedCountry,
  NormalizedVenue,
  NormalizedLineup,
  NormalizedMatch,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedPlayerStatistics,
  NormalizedSeason,
  NormalizedTeam,
  NormalizedTeamStatistics,
  NormalizedTransfer,
  ProviderCapabilities,
} from './types';

export type SyncParams = Record<string, string | number | boolean | undefined>;

/**
 * Provider adapter contract. Every method returns NORMALIZED DTOs —
 * provider-specific shapes must never leave the adapter.
 * All fetch methods are optional; support is advertised via `capabilities`.
 */
export interface FootballDataProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /** Liveness probe. Throw on failure; sync maps the error to health. */
  ping?(): Promise<void>;

  getCountries?(params?: SyncParams): Promise<NormalizedCountry[]>;
  getVenues?(params?: SyncParams): Promise<NormalizedVenue[]>;
  getCompetitions?(params?: SyncParams): Promise<NormalizedCompetition[]>;
  getSeasons?(params?: SyncParams): Promise<NormalizedSeason[]>;
  getTeams?(params?: SyncParams): Promise<NormalizedTeam[]>;
  getPlayers?(params?: SyncParams): Promise<NormalizedPlayer[]>;
  getMatches?(params?: SyncParams): Promise<NormalizedMatch[]>;
  getMatchEvents?(params?: SyncParams): Promise<NormalizedMatchEvent[]>;
  getLineups?(params?: SyncParams): Promise<NormalizedLineup[]>;
  getTeamStatistics?(params?: SyncParams): Promise<NormalizedTeamStatistics[]>;
  getPlayerStatistics?(params?: SyncParams): Promise<NormalizedPlayerStatistics[]>;
  getTransfers?(params?: SyncParams): Promise<NormalizedTransfer[]>;
}
