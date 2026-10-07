import type { FootballDataProvider } from '../src/providers/provider';
import { registerProvider, unregisterProvider } from '../src/providers/registry';
import type { ProviderCapabilities } from '../src/providers/types';

export const ALL_CAPABILITIES: ProviderCapabilities = {
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

export const NO_CAPABILITIES: ProviderCapabilities = {
  countries: false,
  venues: false,
  competitions: false,
  seasons: false,
  teams: false,
  players: false,
  matches: false,
  events: false,
  lineups: false,
  'team-stats': false,
  'player-stats': false,
  transfers: false,
};

export interface MockCalls {
  ping: number;
  getTeams: number;
}

export function makeMockProvider(overrides: Partial<FootballDataProvider> = {}): {
  provider: FootballDataProvider;
  calls: MockCalls;
} {
  const calls: MockCalls = { ping: 0, getTeams: 0 };
  const provider: FootballDataProvider = {
    name: 'mock',
    capabilities: { ...ALL_CAPABILITIES },
    ping: async () => {
      calls.ping += 1;
    },
    getTeams: async () => {
      calls.getTeams += 1;
      return [
        { externalId: 'm-t1', name: 'Mock United', shortName: 'MUN', countryCode: 'ENG' },
        { externalId: 'm-t2', name: 'Mock City', shortName: 'MCI', countryCode: 'ENG' },
      ];
    },
    ...overrides,
  };
  return { provider, calls };
}

export function registerMock(create: () => FootballDataProvider = () => makeMockProvider().provider): void {
  registerProvider({ name: 'mock', priority: 100, enabled: true, createAdapter: create });
}

export function unregisterMock(): void {
  unregisterProvider('mock');
}

export const MOCK_DATA_SOURCE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Mock Provider',
  provider: 'mock',
  api_version: 'v1',
  is_active: true,
  priority: 100,
};
