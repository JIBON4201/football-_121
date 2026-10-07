/**
 * Deterministic seed fixtures. Fictional clubs/players keep the default
 * import scope obviously synthetic until a commercial provider is wired.
 * External IDs are stable (`seed-*`) so re-runs resolve to the same rows.
 */
import type {
  NormalizedCompetition,
  NormalizedCountry,
  NormalizedLineup,
  NormalizedMatch,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedPlayerStatistics,
  NormalizedSeason,
  NormalizedTeam,
  NormalizedTeamStatistics,
  NormalizedTransfer,
  NormalizedVenue,
} from '../types';

export const SEED_COUNTRIES: NormalizedCountry[] = [
  { externalId: 'seed-country-eng', name: 'England', code: 'ENG' },
  { externalId: 'seed-country-esp', name: 'Spain', code: 'ESP' },
];

export const SEED_COMPETITIONS: NormalizedCompetition[] = [
  { externalId: 'seed-comp-epl', name: 'Premier League', shortName: 'EPL', countryCode: 'ENG', type: 'league', gender: 'male' },
];

export const SEED_SEASONS: NormalizedSeason[] = [
  {
    externalId: 'seed-season-2627',
    competitionExternalId: 'seed-comp-epl',
    name: '2026/27',
    startDate: '2026-08-01',
    endDate: '2027-05-31',
  },
];

export const SEED_VENUES: NormalizedVenue[] = [
  { externalId: 'seed-venue-nbp', name: 'Northbridge Park', city: 'London', countryCode: 'ENG', capacity: 40000 },
  { externalId: 'seed-venue-evs', name: 'Eastvale Stadium', city: 'Liverpool', countryCode: 'ENG', capacity: 35000 },
];

export const SEED_TEAMS: NormalizedTeam[] = [
  {
    externalId: 'seed-team-nbu',
    name: 'Northbridge United',
    shortName: 'NBU',
    countryCode: 'ENG',
    foundedYear: 1892,
    venueExternalId: 'seed-venue-nbp',
    seasonExternalId: 'seed-season-2627',
    competitionExternalIds: ['seed-comp-epl'],
  },
  {
    externalId: 'seed-team-evc',
    name: 'Eastvale City',
    shortName: 'EVC',
    countryCode: 'ENG',
    foundedYear: 1901,
    venueExternalId: 'seed-venue-evs',
    seasonExternalId: 'seed-season-2627',
    competitionExternalIds: ['seed-comp-epl'],
  },
  {
    externalId: 'seed-team-spr',
    name: 'Southport Rovers',
    shortName: 'SPR',
    countryCode: 'ENG',
    foundedYear: 1888,
    seasonExternalId: 'seed-season-2627',
    competitionExternalIds: ['seed-comp-epl'],
  },
  {
    externalId: 'seed-team-wfa',
    name: 'Westfield Athletic',
    shortName: 'WFA',
    countryCode: 'ENG',
    foundedYear: 1910,
    seasonExternalId: 'seed-season-2627',
    competitionExternalIds: ['seed-comp-epl'],
  },
];

export const SEED_PLAYERS: NormalizedPlayer[] = [
  { externalId: 'seed-player-thornton', firstName: 'James', lastName: 'Thornton', displayName: 'James Thornton', dateOfBirth: '1998-03-14', nationalityCode: 'ENG', position: 'Forward', preferredFoot: 'right', heightCm: 184, currentTeamExternalId: 'seed-team-nbu' },
  { externalId: 'seed-player-okafor', firstName: 'Daniel', lastName: 'Okafor', displayName: 'Daniel Okafor', dateOfBirth: '2000-07-02', nationalityCode: 'ENG', position: 'Midfielder', preferredFoot: 'left', heightCm: 178, currentTeamExternalId: 'seed-team-nbu' },
  { externalId: 'seed-player-mendez', firstName: 'Carlos', lastName: 'Mendez', displayName: 'Carlos Mendez', dateOfBirth: '1996-11-30', nationalityCode: 'ESP', position: 'Forward', preferredFoot: 'left', heightCm: 180, currentTeamExternalId: 'seed-team-evc' },
  { externalId: 'seed-player-wright', firstName: 'Thomas', lastName: 'Wright', displayName: 'Thomas Wright', dateOfBirth: '1994-01-22', nationalityCode: 'ENG', position: 'Defender', preferredFoot: 'right', heightCm: 188, currentTeamExternalId: 'seed-team-evc' },
  { externalId: 'seed-player-bennett', firstName: 'Oliver', lastName: 'Bennett', displayName: 'Oliver Bennett', dateOfBirth: '1992-05-19', nationalityCode: 'ENG', position: 'Goalkeeper', preferredFoot: 'right', heightCm: 193, currentTeamExternalId: 'seed-team-spr' },
  { externalId: 'seed-player-demir', firstName: 'Yusuf', lastName: 'Demir', displayName: 'Yusuf Demir', dateOfBirth: '1999-09-08', nationalityCode: 'ESP', position: 'Midfielder', preferredFoot: 'both', currentTeamExternalId: 'seed-team-spr' },
  { externalId: 'seed-player-collins', firstName: 'Harry', lastName: 'Collins', displayName: 'Harry Collins', dateOfBirth: '1995-12-11', nationalityCode: 'ENG', position: 'Defender', preferredFoot: 'right', heightCm: 186, currentTeamExternalId: 'seed-team-wfa' },
  { externalId: 'seed-player-ferreira', firstName: 'Lucas', lastName: 'Ferreira', displayName: 'Lucas Ferreira', dateOfBirth: '1997-04-25', nationalityCode: 'ESP', position: 'Forward', preferredFoot: 'right', heightCm: 182, currentTeamExternalId: 'seed-team-evc' },
];

export const SEED_MATCHES: NormalizedMatch[] = [
  {
    externalId: 'seed-match-1',
    competitionExternalId: 'seed-comp-epl',
    seasonExternalId: 'seed-season-2627',
    venueExternalId: 'seed-venue-nbp',
    homeTeamExternalId: 'seed-team-nbu',
    awayTeamExternalId: 'seed-team-evc',
    scheduledAt: '2026-09-12T15:00:00.000Z',
    status: 'finished',
    homeScore: 2,
    awayScore: 1,
    round: 'Matchday 5',
    matchday: 5,
  },
  {
    externalId: 'seed-match-2',
    competitionExternalId: 'seed-comp-epl',
    seasonExternalId: 'seed-season-2627',
    venueExternalId: 'seed-venue-evs',
    homeTeamExternalId: 'seed-team-spr',
    awayTeamExternalId: 'seed-team-wfa',
    scheduledAt: '2026-09-13T15:00:00.000Z',
    status: 'finished',
    homeScore: 0,
    awayScore: 0,
    round: 'Matchday 5',
    matchday: 5,
  },
  {
    externalId: 'seed-match-3',
    competitionExternalId: 'seed-comp-epl',
    seasonExternalId: 'seed-season-2627',
    venueExternalId: 'seed-venue-nbp',
    homeTeamExternalId: 'seed-team-nbu',
    awayTeamExternalId: 'seed-team-spr',
    scheduledAt: '2030-02-01T15:00:00.000Z',
    status: 'scheduled',
    round: 'Matchday 24',
    matchday: 24,
  },
];

export const SEED_EVENTS: NormalizedMatchEvent[] = [
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-nbu', playerExternalId: 'seed-player-thornton', type: 'goal', minute: 23 },
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-evc', playerExternalId: 'seed-player-wright', type: 'yellow_card', minute: 55 },
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-evc', playerExternalId: 'seed-player-mendez', type: 'goal', minute: 78 },
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-nbu', playerExternalId: 'seed-player-okafor', type: 'goal', minute: 84 },
];

export const SEED_LINEUPS: NormalizedLineup[] = [
  {
    matchExternalId: 'seed-match-1',
    teamExternalId: 'seed-team-nbu',
    formation: '4-4-2',
    coachName: 'Alan Partridge',
    players: [
      { playerExternalId: 'seed-player-thornton', position: 'Forward', shirtNumber: 9, starter: true, captain: true, minutesPlayed: 90 },
      { playerExternalId: 'seed-player-okafor', position: 'Midfielder', shirtNumber: 8, starter: true, minutesPlayed: 90 },
    ],
  },
  {
    matchExternalId: 'seed-match-1',
    teamExternalId: 'seed-team-evc',
    formation: '4-3-3',
    coachName: 'Maria Gomez',
    players: [
      { playerExternalId: 'seed-player-mendez', position: 'Forward', shirtNumber: 10, starter: true, minutesPlayed: 90 },
      { playerExternalId: 'seed-player-wright', position: 'Defender', shirtNumber: 4, starter: true, minutesPlayed: 90 },
    ],
  },
];

export const SEED_TEAM_STATS: NormalizedTeamStatistics[] = [
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-nbu', possession: 54, shots: 12, shotsOnTarget: 5, corners: 6, fouls: 9, passAccuracy: 86 },
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-evc', possession: 46, shots: 9, shotsOnTarget: 3, corners: 4, fouls: 11, passAccuracy: 82 },
];

export const SEED_PLAYER_STATS: NormalizedPlayerStatistics[] = [
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-nbu', playerExternalId: 'seed-player-thornton', minutes: 90, goals: 1, shots: 4, shotsOnTarget: 2, rating: 8.2 },
  { matchExternalId: 'seed-match-1', teamExternalId: 'seed-team-evc', playerExternalId: 'seed-player-mendez', minutes: 90, goals: 1, shots: 3, shotsOnTarget: 1, rating: 7.6 },
];

export const SEED_TRANSFERS: NormalizedTransfer[] = [
  {
    externalId: 'seed-transfer-1',
    playerExternalId: 'seed-player-ferreira',
    fromTeamExternalId: 'seed-team-wfa',
    toTeamExternalId: 'seed-team-evc',
    transferType: 'permanent',
    status: 'completed',
    fee: 15000000,
    currency: 'EUR',
    announcementDate: '2026-06-20T10:00:00.000Z',
    effectiveDate: '2026-07-01T00:00:00.000Z',
    seasonExternalId: 'seed-season-2627',
    windowName: 'Summer 2026',
  },
];
