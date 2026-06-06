/** Ratings a user must give before their entry can compete on the leaderboard. */
export const LEADERBOARD_MIN_RATINGS_GIVEN = 20

export const calcScore = (avgRating, totalVotes) => {
  if (!totalVotes || totalVotes === 0) return 0
  return parseFloat((avgRating * Math.log10(totalVotes + 1)).toFixed(2))
}

export const scoreEntry = (entry) => {
  const votes = entry.votes || []
  const totalVotes = votes.length
  const avgRating = totalVotes > 0 ? votes.reduce((s, v) => s + v.rating, 0) / totalVotes : 0
  return {
    ...entry,
    totalVotes,
    avgRating: totalVotes > 0 ? avgRating.toFixed(1) : '0.0',
    avgRatingNum: avgRating,
    score: calcScore(avgRating, totalVotes),
  }
}

export const scoreAndSortEntries = (entries) =>
  entries.map(scoreEntry).sort((a, b) => b.score - a.score)

/** Entry competes only if its owner has rated enough PFPs (all-time). */
export const canParticipateInLeaderboard = (entryAnonId, raterCounts) =>
  !!entryAnonId && (raterCounts[entryAnonId] || 0) >= LEADERBOARD_MIN_RATINGS_GIVEN

/** Ranked leaderboard pool: owners who gave 20+ ratings. */
export const leaderboardParticipating = (scored, raterCounts) =>
  scored.filter((e) => canParticipateInLeaderboard(e.anon_id, raterCounts))

/** Top X% globally (1 = top 1%). Uses competing entries only. */
export const calcGlobalTopPercent = (allScored, entry, raterCounts) => {
  const pool = leaderboardParticipating(allScored, raterCounts)
  if (!entry || pool.length === 0) return null
  const rank = pool.findIndex((e) => e.id === entry.id) + 1
  if (rank === 0) return null
  return Math.max(1, Math.ceil((rank / pool.length) * 100))
}
