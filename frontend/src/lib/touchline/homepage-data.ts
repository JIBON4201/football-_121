import type { HomepageData } from "./homepage-types";
import {
  loadBreakingNews,
  loadCompetitions,
  loadLatestWindow,
  loadLiveMatches,
  loadPlayers,
  loadRecentMatches,
  loadTeams,
  loadTransferNews,
  loadTransfers,
  loadUpcomingMatches,
  toBreakingItems,
} from "./homepage-api";

/**
 * The homepage data seam.
 *
 * Every feed is fetched from the Football API (`/api/v1`) through the adapters in
 * `homepage-api.ts`. Sections are loaded independently, so a failing or empty feed
 * degrades to the section's own empty state instead of failing the page, and no
 * section is ever populated with demo content.
 *
 * This is the only loader that needs the whole site dataset: the homepage renders
 * every section. Routes that need a subset ask `site-data.ts` for just their feeds,
 * so they never pay for sections they do not show.
 */
export async function getHomepageData(): Promise<HomepageData> {
  const [liveMatches, upcomingMatches, recentMatches, latestWindow, breakingNews, transferNews, competitions, teams, players, transfers] =
    await Promise.all([
      loadLiveMatches(),
      loadUpcomingMatches(),
      loadRecentMatches(),
      loadLatestWindow(),
      loadBreakingNews(),
      loadTransferNews(),
      loadCompetitions(),
      loadTeams(),
      loadPlayers(),
      loadTransfers(),
    ]);

  return {
    isDemo: false,
    featuredStory: latestWindow.featured,
    supportingStories: latestWindow.supporting,
    liveMatches,
    breakingNews: toBreakingItems(breakingNews),
    upcomingMatches,
    recentMatches,
    latestNews: latestWindow.latest,
    transfers,
    transferStories: transferNews,
    competitions,
    teams,
    players,
  };
}
