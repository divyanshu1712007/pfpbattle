import { supabase } from './supabase'

/**
 * Exposure: entries from users who rate more often surface higher in swipe/rate feeds.
 * Uses votes cast this week (anon_id on votes), keyed by the entry owner's anon_id.
 */
export const buildRaterActivityCounts = (votesRows) => {
  const counts = {}
  for (const row of votesRows || []) {
    if (!row.anon_id) continue
    counts[row.anon_id] = (counts[row.anon_id] || 0) + 1
  }
  return counts
}

export const exposureScore = (entry, raterCounts) => {
  const activity = raterCounts[entry.anon_id] || 0
  const views = entry.view_count || 0
  return activity * 3 + Math.sqrt(activity + 1) * 2 - views * 0.35 + Math.random()
}

export const sortEntriesByExposure = (entries, raterCounts) =>
  [...entries].sort((a, b) => exposureScore(b, raterCounts) - exposureScore(a, raterCounts))

export const fetchWeekRaterCounts = async (week) => {
  const { data: votesData } = await supabase.from('votes').select('anon_id').eq('week_number', week)
  return buildRaterActivityCounts(votesData)
}

/** Total ratings each anon_id has ever given (leaderboard participation gate). */
export const fetchAllTimeRaterCounts = async () => {
  const { data: votesData } = await supabase.from('votes').select('anon_id')
  return buildRaterActivityCounts(votesData)
}

export const loadWeekFeedEntries = async (week, year) => {
  const [{ data: entriesData, error: entriesError }, { data: votesData }] = await Promise.all([
    supabase.from('entries').select('*').eq('week_number', week).eq('year', year),
    supabase.from('votes').select('anon_id').eq('week_number', week),
  ])
  if (entriesError) return { entries: [], error: entriesError }

  const lastWeek = week - 1 === 0 ? 52 : week - 1
  const lastYear = week - 1 === 0 ? year - 1 : year

  // Always pad with last week's entries if current week has fewer than 10
  let allEntries = entriesData || []
  if (allEntries.length < 10) {
    const { data: lastEntries } = await supabase
      .from('entries').select('*').eq('week_number', lastWeek).eq('year', lastYear)
    if (lastEntries?.length) {
      // Avoid duplicates by username
      const existingNames = new Set(allEntries.map(e => e.username))
      const padEntries = lastEntries.filter(e => !existingNames.has(e.username))
      allEntries = [...allEntries, ...padEntries]
    }
  }

  const raterCounts = buildRaterActivityCounts(votesData)
  return { entries: sortEntriesByExposure(allEntries, raterCounts), raterCounts }
}