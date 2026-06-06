import { supabase } from './supabase'
import { fetchAllTimeRaterCounts } from './feed'
import {
  scoreAndSortEntries,
  leaderboardParticipating,
} from './scoring'

export const computeLifetimeStats = async (username) => {
  if (!username?.trim()) return null

  const [{ data: entries }, { data: wins }] = await Promise.all([
    supabase.from('entries').select('*, votes(rating)').ilike('username', username.trim()),
    supabase.from('weekly_results').select('*').ilike('username', username.trim()).eq('rank', 1),
  ])

  if (!entries?.length) return null

  const raterCounts = await fetchAllTimeRaterCounts()
  let bestRank = Infinity
  let top10Count = 0
  let top100Count = 0
  const weeksByKey = new Map()

  for (const entry of entries) {
    const key = `${entry.year}-${entry.week_number}`
    if (weeksByKey.has(key)) continue

    const { data: weekEntries } = await supabase
      .from('entries')
      .select('*, votes(rating)')
      .eq('week_number', entry.week_number)
      .eq('year', entry.year)

    if (!weekEntries?.length) continue

    const scored = scoreAndSortEntries(weekEntries)
    const pool = leaderboardParticipating(scored, raterCounts)
    const rank = pool.findIndex((e) => e.username?.toLowerCase() === username.trim().toLowerCase()) + 1
    if (rank === 0) continue

    weeksByKey.set(key, { week: entry.week_number, year: entry.year, rank })
    if (rank < bestRank) bestRank = rank
    if (rank <= 10) top10Count++
    if (rank <= 100) top100Count++
  }

  // ↓ CHANGED: sort most-recent-first, extract rank array for streak calc in Profile
  const weekRanks = [...weeksByKey.values()]
    .sort((a, b) => b.year - a.year || b.week - a.week)
    .map((w) => w.rank)

  return {
    winsCount: wins?.length || 0,
    top10Count,
    top100Count,
    bestRank: bestRank === Infinity ? null : bestRank,
    weeksRanked: weeksByKey.size,
    weekRanks,   // ← new
  }
}