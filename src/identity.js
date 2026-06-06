import { supabase } from './supabase'

const ANON_ID_KEY = 'anon_id'
const REGION_KEY  = 'locked_region'

const isValidUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

export const getAnonId = () => {
  let id = localStorage.getItem(ANON_ID_KEY)
  if (!isValidUuid(id)) {
    id = crypto.randomUUID()
    localStorage.setItem(ANON_ID_KEY, id)
  }
  return id
}

export const detectRegion = async () => {
  const cached = localStorage.getItem(REGION_KEY)
  if (cached) return cached
  try {
    const res  = await fetch('https://ipapi.co/json/')
    const data = await res.json()
    const country = data.country_name || 'Other'
    localStorage.setItem(REGION_KEY, country)
    return country
  } catch {
    return 'Other'
  }
}

export const getLockedRegion = () => localStorage.getItem(REGION_KEY) || null

// ↓ CHANGED: accepts optional `region` param so callers can pass it in
export const ensureAnonymousUser = async (votesGiven = 0, region = null) => {
  const id = getAnonId()
  if (!region) region = await detectRegion()

  const { data: existing } = await supabase
    .from('anonymous_users')
    .select('locked_region')
    .eq('id', id)
    .maybeSingle()

  const lockedRegion = existing?.locked_region || region

  if (lockedRegion) localStorage.setItem(REGION_KEY, lockedRegion)

  const { error } = await supabase.from('anonymous_users').upsert(
    {
      id,
      votes_given:   votesGiven,
      last_seen_at:  new Date().toISOString(),
      locked_region: lockedRegion,
    },
    { onConflict: 'id' }
  )

  if (error?.code === 'PGRST205' || error?.message?.includes('anonymous_users')) {
    return { ok: false, id }
  }
  return { ok: !error, id, region: lockedRegion, error }
}

export const syncVotesGivenFromServer = async () => {
  const id = getAnonId()

  const [votesRes, userRes] = await Promise.all([
    supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('anon_id', id),
    supabase
      .from('anonymous_users')
      .select('locked_region')
      .eq('id', id)
      .maybeSingle(),
  ])

  if (userRes.data?.locked_region) {
    localStorage.setItem(REGION_KEY, userRes.data.locked_region)
  }

  const { count, error } = votesRes
  if (error || count == null) return null

  const localTotal  = parseInt(localStorage.getItem('total_votes_given') || '0', 10)
  const localShare  = parseInt(localStorage.getItem('votes_given')       || '0', 10)
  const mergedTotal = Math.max(localTotal, count)
  const mergedShare = Math.max(localShare, count)
  localStorage.setItem('total_votes_given', String(mergedTotal))
  localStorage.setItem('votes_given',       String(mergedShare))
  return mergedTotal
}