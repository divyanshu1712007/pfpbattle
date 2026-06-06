import { supabase } from './supabase'
import { getAnonId } from './identity'

const votedKey = (entryId) => `voted_${entryId}`

/** Sync local voted flags from server for this week. */
export const syncWeekVotesForUser = async (week) => {
  const anonId = getAnonId()
  const { data } = await supabase
    .from('votes')
    .select('entry_id')
    .eq('anon_id', anonId)
    .eq('week_number', week)
  if (data) data.forEach((v) => localStorage.setItem(votedKey(v.entry_id), 'true'))
}

export const hasVotedLocally = (entryId) => !!localStorage.getItem(votedKey(entryId))

/** Server + client: one vote per anon per entry per week. */
export const castVote = async ({ entryId, rating, week }) => {
  const anonId = getAnonId()
  if (hasVotedLocally(entryId)) return { ok: true, skipped: true }

  const { count } = await supabase
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .eq('entry_id', entryId)
    .eq('anon_id', anonId)
    .eq('week_number', week)

  if (count > 0) {
    localStorage.setItem(votedKey(entryId), 'true')
    return { ok: true, skipped: true }
  }

  const { error } = await supabase.from('votes').insert([
    { entry_id: entryId, rating, week_number: week, anon_id: anonId },
  ])

  if (error) {
    if (error.code === '23505') {
      localStorage.setItem(votedKey(entryId), 'true')
      return { ok: true, skipped: true }
    }
    return { ok: false, error: error.message }
  }

  localStorage.setItem(votedKey(entryId), 'true')
  return { ok: true, skipped: false }
}
