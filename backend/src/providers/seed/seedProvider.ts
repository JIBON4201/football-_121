import { registerProvider } from '../registry';
import type { FootballDataProvider, SyncParams } from '../provider';
import type { ProviderCapabilities } from '../types';
import {
  SEED_COMPETITIONS,
  SEED_COUNTRIES,
  SEED_EVENTS,
  SEED_LINEUPS,
  SEED_MATCHES,
  SEED_PLAYERS,
  SEED_PLAYER_STATS,
  SEED_SEASONS,
  SEED_TEAMS,
  SEED_TEAM_STATS,
  SEED_TRANSFERS,
  SEED_VENUES,
} from './seedData';

export const SEED_PROVIDER_NAME = 'seed';

const CAPABILITIES: ProviderCapabilities = {
  countries: true,
  venues: true,
  competitions: true,
  seasons: true,
  teams: true,
  players: true,
  matches: true,
  events: true,
  lineups: true,
  'team-stats': true,
  'player-stats': true,
  transfers: true,
};

function strParam(params: SyncParams | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function numParam(params: SyncParams | undefined, key: string): number | undefined {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Deterministic offline provider for initial seeding and pipeline tests.
 * Honors the recommended scope convention: competitionExternalId,
 * seasonExternalId, teamExternalIds (comma-separated), from/to (ISO dates),
 * limit. No network, no secrets.
 */
export function createSeedProvider(): FootballDataProvider {
  const limitTo = <T>(rows: T[], params?: SyncParams): T[] => {
    const limit = numParam(params, 'limit');
    return limit !== undefined ? rows.slice(0, Math.max(0, Math.min(limit, 5000))) : rows;
  };

  return {
    name: SEED_PROVIDER_NAME,
    capabilities: { ...CAPABILITIES },
    ping: async () => undefined,
    getCountries: async () => [...SEED_COUNTRIES],
    getVenues: async () => [...SEED_VENUES],
    getCompetitions: async (params) => {
      const only = strParam(params, 'competitionExternalId');
      const rows = only ? SEED_COMPETITIONS.filter((row) => row.externalId === only) : SEED_COMPETITIONS;
      return limitTo([...rows], params);
    },
    getSeasons: async (params) => {
      const only = strParam(params, 'competitionExternalId');
      const rows = only ? SEED_SEASONS.filter((row) => row.competitionExternalId === only) : SEED_SEASONS;
      return limitTo([...rows], params);
    },
    getTeams: async (params) => {
      const comp = strParam(params, 'competitionExternalId');
      const teams = strParam(params, 'teamExternalIds')?.split(',').filter(Boolean);
      return limitTo(
        SEED_TEAMS.filter(
          (row) =>
            (!comp || (row.competitionExternalIds ?? []).includes(comp)) &&
            (!teams || teams.includes(row.externalId)),
        ),
        params,
      );
    },
    getPlayers: async (params) => {
      const teams = strParam(params, 'teamExternalIds')?.split(',').filter(Boolean);
      return limitTo(
        SEED_PLAYERS.filter((row) => !teams || (row.currentTeamExternalId && teams.includes(row.currentTeamExternalId))),
        params,
      );
    },
    getMatches: async (params) => {
      const comp = strParam(params, 'competitionExternalId');
      const season = strParam(params, 'seasonExternalId');
      const from = strParam(params, 'from');
      const to = strParam(params, 'to');
      return limitTo(
        SEED_MATCHES.filter(
          (row) =>
            (!comp || row.competitionExternalId === comp) &&
            (!season || row.seasonExternalId === season) &&
            (!from || row.scheduledAt >= from) &&
            (!to || row.scheduledAt <= to),
        ),
        params,
      );
    },
    getMatchEvents: async (params) => {
      const match = strParam(params, 'matchExternalId');
      return limitTo(SEED_EVENTS.filter((row) => !match || row.matchExternalId === match), params);
    },
    getLineups: async (params) => {
      const match = strParam(params, 'matchExternalId');
      return limitTo(SEED_LINEUPS.filter((row) => !match || row.matchExternalId === match), params);
    },
    getTeamStatistics: async (params) => {
      const match = strParam(params, 'matchExternalId');
      return limitTo(SEED_TEAM_STATS.filter((row) => !match || row.matchExternalId === match), params);
    },
    getPlayerStatistics: async (params) => {
      const match = strParam(params, 'matchExternalId');
      return limitTo(SEED_PLAYER_STATS.filter((row) => !match || row.matchExternalId === match), params);
    },
    getTransfers: async () => [...SEED_TRANSFERS],
  };
}

/** Lowest precedence — a fallback source, never shadowing commercial providers. */
export function registerSeedProvider(): void {
  registerProvider({
    name: SEED_PROVIDER_NAME,
    priority: 1000,
    enabled: true,
    createAdapter: createSeedProvider,
  });
}
