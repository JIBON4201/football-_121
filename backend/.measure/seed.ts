/**
 * Temporary measurement fixture (not part of the shipped app).
 * Seeds a realistic full-size dataset so list pages render 12 rows per feed and
 * per-match details carry true heavyweight volume (lineups, stats, events).
 */
import { FakeClient, seedStore, type FakeStore } from '../tests/fake';

const TEAM_COUNT = 24;
const FEED_SIZE = 12;

function uuidFor(kind: string, n: number): string {
  const tail = String(n).padStart(12, '0');
  const prefix = kind.padEnd(8, '0');
  return `${prefix}-0000-4000-8000-${tail}`;
}

export function buildMeasureStore(): FakeStore {
  const store = seedStore();

  const competitions = [
    {
      id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      slug: 'premier-league',
      name: 'Premier League',
      short_name: 'EPL',
      country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      type: 'league',
      is_active: true,
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-fffffffffff2',
      slug: 'champions-league',
      name: 'UEFA Champions League',
      short_name: 'UCL',
      country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      type: 'continental',
      is_active: true,
    },
  ];
  store.competitions = competitions;

  const venues = Array.from({ length: 8 }, (_, i) => ({
    id: uuidFor('aaaaaaaa', i + 1),
    slug: `venue-${i + 1}`,
    name: `Stadium ${i + 1}`,
    city: ['London', 'Madrid', 'Milan', 'Munich', 'Paris', 'Barcelona', 'Amsterdam', 'Lisbon'][i],
    country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    capacity: 40000 + i * 5000,
  }));
  store.venues = venues;

  const teams = Array.from({ length: TEAM_COUNT }, (_, i) => ({
    id: uuidFor('bbbbbbbb', i + 1),
    slug: `club-${String(i + 1).padStart(2, '0')}`,
    name: `Club Name ${String(i + 1).padStart(2, '0')}`,
    short_name: `C${String(i + 1).padStart(2, '0')}`,
    country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    is_active: true,
  }));
  store.teams = teams;

  // 22 players per club, enough for a full 11 + subs lineup with real stat rows.
  const players: Record<string, unknown>[] = [];
  teams.forEach((team, ti) => {
    for (let p = 0; p < 22; p += 1) {
      players.push({
        id: uuidFor('cccccccc', ti * 22 + p + 1),
        slug: `player-${ti + 1}-${p + 1}`,
        display_name: `Player ${ti + 1}.${p + 1}`,
        first_name: `First${ti + 1}`,
        last_name: `Last${p + 1}`,
        position: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'][p % 4],
        nationality_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        team_id: team.id,
      });
    }
  });
  store.players = players;

  const matches: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const lineups: Record<string, unknown>[] = [];
  const lineupPlayers: Record<string, unknown>[] = [];
  const teamStats: Record<string, unknown>[] = [];
  const playerStats: Record<string, unknown>[] = [];
  const seasons = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      competition_id: competitions[0].id,
      name: '2026/27',
      start_date: '2026-08-01',
      end_date: '2027-05-31',
      is_current: true,
    },
  ];
  store.seasons = seasons;

  const EVENT_MIX = [
    'goal',
    'goal',
    'own_goal',
    'penalty_goal',
    'yellow_card',
    'yellow_card',
    'red_card',
    'substitution',
    'injury',
    'var',
    'offside',
    'corner',
  ];

  let matchIndex = 0;
  const addMatch = (status: string, dayOffset: number, live: boolean): void => {
    for (let i = 0; i < FEED_SIZE; i += 1) {
      matchIndex += 1;
      const homeIdx = (matchIndex * 2) % TEAM_COUNT;
      let awayIdx = (matchIndex * 2 + 1) % TEAM_COUNT;
      if (awayIdx === homeIdx) awayIdx = (awayIdx + 1) % TEAM_COUNT;
      const home = teams[homeIdx];
      const away = teams[awayIdx];
      const matchId = uuidFor('dddddddd', matchIndex);
      const day = new Date(Date.UTC(2026, 8, 1 + dayOffset, 12 + (i % 8), (i * 7) % 60));
      const slug = `${home.slug}-vs-${away.slug}-${day.toISOString().slice(0, 10)}`;

      matches.push({
        id: matchId,
        slug,
        status,
        scheduled_at: day.toISOString(),
        competition_id: competitions[matchIndex % competitions.length].id,
        season_id: seasons[0].id,
        venue_id: venues[matchIndex % venues.length].id,
        home_team_id: home.id,
        away_team_id: away.id,
        round: (i % 38) + 1,
        matchday: i + 1,
        referee_name: `Referee ${matchIndex}`,
        attendance: 30000 + i * 500,
        ...(live
          ? { home_score: i % 4, away_score: (i + 1) % 3, home_score_ht: i % 4, away_score_ht: (i + 1) % 3 }
          : {}),
        ...(status === 'finished' ? { home_score: i % 4, away_score: (i + 1) % 3, home_score_ht: (i % 4) - 1, away_score_ht: (i + 1) % 3 } : {}),
      });

      // ~25 events per match, including the goal/card types a card renders.
      const eventCount = 22 + (i % 6);
      for (let e = 0; e < eventCount; e += 1) {
        const isHome = e % 2 === 0;
        const team = isHome ? home : away;
        const teamPlayers = players.filter((p) => p.team_id === team.id);
        events.push({
          id: uuidFor('99999999', matchIndex * 100 + e + 1),
          match_id: matchId,
          team_id: team.id,
          player_id: (teamPlayers[e % teamPlayers.length] as { id: string }).id,
          assist_player_id: (teamPlayers[(e + 3) % teamPlayers.length] as { id: string }).id,
          type: EVENT_MIX[e % EVENT_MIX.length],
          minute: Math.min(90, 3 + e * 4),
          extra_minute: e % 7 === 0 ? 2 : null,
          description: `Event ${e + 1} description text for the ${team.name} timeline entry`,
        });
      }

      // Full lineups: 11 starters + 7 subs per side, each with a nested player.
      [home, away].forEach((team, side) => {
        const lineupId = uuidFor('77777777', matchIndex * 2 + side + 1);
        lineups.push({
          id: lineupId,
          match_id: matchId,
          team_id: team.id,
          formation: side === 0 ? '4-3-3' : '4-2-3-1',
          coach_name: `Coach ${side === 0 ? 'Alpha' : 'Beta'} ${matchIndex}`,
        });
        const teamPlayers = players.filter((p) => p.team_id === team.id);
        for (let s = 0; s < 18; s += 1) {
          const player = teamPlayers[s] as Record<string, unknown>;
          const lpId = uuidFor('88888888', matchIndex * 40 + side * 20 + s + 1);
          lineupPlayers.push({
            id: lpId,
            lineup_id: lineupId,
            player_id: player.id,
            position: player.position,
            shirt_number: s + 1,
            captain: s === 0,
            substitute: s >= 11,
            starter: s < 11,
            minutes_played: s < 11 ? 90 : 20,
          });
          // Nested player object on the lineup player row (as the real details API returns).
          playerStats.push({
            id: uuidFor('66666666', matchIndex * 40 + side * 20 + s + 1),
            match_id: matchId,
            team_id: team.id,
            player_id: player.id,
            minutes: s < 11 ? 90 : 20,
            goals: s % 7 === 0 ? 1 : 0,
            assists: s % 9 === 0 ? 1 : 0,
            shots: (s * 3) % 7,
            shots_on_target: (s * 2) % 4,
            passes: 40 + s * 7,
            pass_accuracy: 70 + (s % 25),
            tackles: s % 5,
            interceptions: s % 4,
            clearances: s % 6,
            yellow_cards: s % 11 === 0 ? 1 : 0,
            red_cards: 0,
            rating: 5 + (s % 20) / 10,
          });
        }
      });

      [home, away].forEach((team, side) => {
        teamStats.push({
          id: uuidFor('55555555', matchIndex * 2 + side + 1),
          match_id: matchId,
          team_id: team.id,
          possession: 50 + side * 7 + (i % 5),
          shots: 8 + (i % 9),
          shots_on_target: 3 + (i % 6),
          corners: 4 + (i % 7),
          fouls: 6 + (i % 8),
          offsides: 1 + (i % 5),
          yellow_cards: i % 4,
          red_cards: i % 5 === 0 ? 1 : 0,
          passes: 380 + i * 11,
          pass_accuracy: 74 + (i % 18),
        });
      });
    }
  };

  addMatch('live', 13, true);
  addMatch('finished', 12, false);
  addMatch('finished', 11, false);
  // Upcoming fixtures must be in the future for phase=upcoming.
  for (let i = 0; i < FEED_SIZE * 3; i += 1) {
    matchIndex += 1;
    const homeIdx = (matchIndex * 3) % TEAM_COUNT;
    let awayIdx = (matchIndex * 3 + 5) % TEAM_COUNT;
    if (awayIdx === homeIdx) awayIdx = (awayIdx + 1) % TEAM_COUNT;
    const home = teams[homeIdx];
    const away = teams[awayIdx];
    const day = new Date(Date.UTC(2027, 2, 1 + i, 12 + (i % 8), (i * 11) % 60));
    matches.push({
      id: uuidFor('dddddddd', matchIndex),
      slug: `${home.slug}-vs-${away.slug}-${day.toISOString().slice(0, 10)}`,
      status: i % 3 === 0 ? 'pre_match' : 'scheduled',
      scheduled_at: day.toISOString(),
      competition_id: competitions[matchIndex % competitions.length].id,
      season_id: seasons[0].id,
      venue_id: venues[matchIndex % venues.length].id,
      home_team_id: home.id,
      away_team_id: away.id,
      round: (i % 38) + 1,
      matchday: i + 1,
      referee_name: `Referee ${matchIndex}`,
    });
  }

  store.matches = matches;
  store.match_events = events;
  store.match_lineups = lineups;
  store.match_lineup_players = lineupPlayers;
  store.match_team_statistics = teamStats;
  store.match_player_statistics = playerStats;

  return store;
}

export function buildMeasureClient(): FakeClient {
  return new FakeClient(buildMeasureStore());
}