import { scoreEntry } from './scoring'

/** Trending slices for the current week. */
export const buildTrending = (entries) => {
  const scored = entries.map(scoreEntry)

  const mostViewed = [...scored]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 5)

  const topScorers = [...scored].sort((a, b) => b.score - a.score).slice(0, 5)

  const rising = [...scored]
    .filter((e) => e.totalVotes >= 2 && e.totalVotes <= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return { mostViewed, topScorers, rising }
}
