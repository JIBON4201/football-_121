import type { BreakingItem, HomepageData, NewsStory } from "./homepage-types";
import {
  loadBreakingNews,
  loadCompetitions,
  loadLeadStories,
  loadLatestNews,
  loadLiveMatches,
  loadPlayers,
  loadRecentMatches,
  loadTeams,
  loadTransferNews,
  loadTransfers,
  loadUpcomingMatches,
} from "./homepage-api";

/**
 * The homepage data seam.
 *
 * Every feed is fetched from the Football API (`/api/v1`) through the adapters in
 * `homepage-api.ts`. Sections are loaded independently, so a failing or empty feed
 * degrades to the section's own empty state instead of failing the page, and no
 * section is ever populated with demo content.
 */
export async function getHomepageData(): Promise<HomepageData> {
  const [liveMatches, upcomingMatches, recentMatches, lead, latestNews, breakingNews, transferNews, competitions, teams, players, transfers] =
    await Promise.all([
      loadLiveMatches(),
      loadUpcomingMatches(),
      loadRecentMatches(),
      loadLeadStories(),
      loadLatestNews(),
      loadBreakingNews(),
      loadTransferNews(),
      loadCompetitions(),
      loadTeams(),
      loadPlayers(),
      loadTransfers(),
    ]);

  const toBreakingItems = (stories: NewsStory[]): BreakingItem[] =>
    stories.slice(0, 3).map((story) => ({
      id: story.id,
      headline: story.title,
      publishedAt: story.publishedAt,
      href: story.href,
    }));

  return {
    isDemo: false,
    featuredStory: lead.featured,
    supportingStories: lead.supporting,
    liveMatches,
    breakingNews: toBreakingItems(breakingNews),
    upcomingMatches,
    recentMatches,
    latestNews,
    transfers,
    transferStories: transferNews,
    competitions,
    teams,
    players,
  };
}