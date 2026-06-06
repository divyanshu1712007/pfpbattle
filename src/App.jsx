import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import html2canvas from 'html2canvas'
import { getAnonId, ensureAnonymousUser, syncVotesGivenFromServer } from './identity'
import { loadWeekFeedEntries, fetchAllTimeRaterCounts } from './feed'
import {
  LEADERBOARD_MIN_RATINGS_GIVEN,
  scoreAndSortEntries,
  leaderboardParticipating,
  canParticipateInLeaderboard,
  calcGlobalTopPercent,
} from './scoring'
import { cn, Loading, Page, PageHeader } from './ui'
import { castVote, syncWeekVotesForUser } from './votes'
import { computeLifetimeStats } from './stats'
import { buildTrending } from './trending'

// ── Region auto-detect (IP-based, no permission prompt) ──────────
const REGION_KEY = 'locked_region'

export const detectRegion = async () => {
  const cached = localStorage.getItem(REGION_KEY)
  if (cached) return cached
  try {
    const res = await fetch('https://ipapi.co/json/')
    const data = await res.json()
    const country = data.country_name || 'Other'
    localStorage.setItem(REGION_KEY, country)
    return country
  } catch {
    return 'Other'
  }
}

export const getLockedRegion = () => localStorage.getItem(REGION_KEY) || null

const NAV = [
  ['home', '🏆', 'Board'],
  ['swipe', '🎮', 'Swipe'],
  ['rate', '⭐', 'Rate'],
  ['upload', '📤', 'Enter'],
  ['profile', '👤', 'Profile'],
]

const getWeekNumber = () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  return Math.ceil((((now - start) / 86400000) + start.getDay() + 1) / 7)
}

const VOTES_REQUIRED_TO_SHARE = 3

const getVotesGiven = () => parseInt(localStorage.getItem('votes_given') || '0')
const addVoteGiven = () => localStorage.setItem('votes_given', getVotesGiven() + 1)
const canShare = () => getVotesGiven() >= VOTES_REQUIRED_TO_SHARE

// ── Streak helpers ───────────────────────────────────────────────
const getTodayStr = () => new Date().toISOString().slice(0, 10)
const getStreak = () => parseInt(localStorage.getItem('streak') || '0')
const getLastRatedDay = () => localStorage.getItem('last_rated_day') || ''

const updateStreak = () => {
  const today = getTodayStr()
  const last = getLastRatedDay()
  if (last === today) return
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const newStreak = last === yesterday ? getStreak() + 1 : 1
  localStorage.setItem('streak', newStreak)
  localStorage.setItem('last_rated_day', today)
  return newStreak
}

const isStreakAlive = () => {
  const last = getLastRatedDay()
  if (!last) return false
  const today = getTodayStr()
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  return last === today || last === yesterday
}

// ── Rater badge helpers ──────────────────────────────────────────
const BADGES = [
  { id: 'bronze',   label: 'Bronze',   emoji: '🥉', minVotes: 0,   maxVotes: 9,   color: '#cd7c4a', bg: '#2a1a0a' },
  { id: 'silver',   label: 'Silver',   emoji: '🥈', minVotes: 10,  maxVotes: 29,  color: '#9ca3af', bg: '#1a1a2a' },
  { id: 'gold',     label: 'Gold',     emoji: '🥇', minVotes: 30,  maxVotes: 74,  color: '#f59e0b', bg: '#2a1a00' },
  { id: 'platinum', label: 'Platinum', emoji: '💎', minVotes: 75,  maxVotes: 149, color: '#67e8f9', bg: '#001a2a' },
  { id: 'diamond',  label: 'Diamond',  emoji: '👑', minVotes: 150, maxVotes: 299, color: '#a78bfa', bg: '#1a0533' },
  { id: 'elite',    label: 'Elite',    emoji: '⚡', minVotes: 300, maxVotes: Infinity, color: '#f472b6', bg: '#2a0a1a' },
]

const getBadge = (totalVotes) =>
  BADGES.find(b => totalVotes >= b.minVotes && totalVotes <= b.maxVotes) || BADGES[0]

const getNextBadge = (totalVotes) => {
  const idx = BADGES.findIndex(b => totalVotes >= b.minVotes && totalVotes <= b.maxVotes)
  return idx < BADGES.length - 1 ? BADGES[idx + 1] : null
}

// ── Competitor badge helpers ─────────────────────────────────────
// Based on best rank achieved this week in the competing pool
const COMP_BADGES = [
  { id: 'champ',  label: 'Champion', emoji: '👑', color: '#fbbf24', minRank: 1,  maxRank: 1   },
  { id: 'top3',   label: 'Top 3',    emoji: '🥇', color: '#f59e0b', minRank: 2,  maxRank: 3   },
  { id: 'top10',  label: 'Top 10',   emoji: '🔥', color: '#f472b6', minRank: 4,  maxRank: 10  },
  { id: 'top50',  label: 'Top 50',   emoji: '⭐', color: '#67e8f9', minRank: 11, maxRank: 50  },
  { id: 'ranked', label: 'Ranked',   emoji: '🏅', color: '#9ca3af', minRank: 51, maxRank: Infinity },
]

const getCompBadge = (rank) => {
  if (!rank || rank < 1) return null
  return COMP_BADGES.find(b => rank >= b.minRank && rank <= b.maxRank) || null
}

const getTotalVotesGiven = () => parseInt(localStorage.getItem('total_votes_given') || '0')
const addTotalVoteGiven = () => {
  const n = getTotalVotesGiven() + 1
  localStorage.setItem('total_votes_given', n)
  return n
}
const hasViewed = (entryId) => !!localStorage.getItem(`viewed_${entryId}`)
const markViewed = (entryId) => localStorage.setItem(`viewed_${entryId}`, 'true')

const recordVote = () => {
  const prevTotal = getTotalVotesGiven()
  const prevBadge = getBadge(prevTotal)
  addVoteGiven()
  const newTotal = addTotalVoteGiven()
  updateStreak()
  ensureAnonymousUser(newTotal)
  const newBadge = getBadge(newTotal)
  if (newBadge.id !== prevBadge.id) {
    window.dispatchEvent(new CustomEvent('pfp_levelup', { detail: newBadge }))
  }
}

const trackView = async (entry) => {
  if (!entry?.id || hasViewed(entry.id)) return
  markViewed(entry.id)
  await supabase.rpc('increment_views', { entry_id: entry.id })
}

// ── Streak & Badge Bar ───────────────────────────────────────────
function StreakBadgeBar() {
  const total = getTotalVotesGiven()
  const streak = getStreak()
  const alive = isStreakAlive()
  const badge = getBadge(total)
  const next = getNextBadge(total)
  const progress = next ? ((total - badge.minVotes) / (next.minVotes - badge.minVotes)) * 100 : 100

  return (
    <div className="stats-bar">
      <div className="stats-item">
        <span>{alive ? '🔥' : '💤'}</span>
        <span className={cn('stats-label', alive ? 'stats-label--hot' : 'stats-label--dim')}>
          {streak} day streak
        </span>
        {!alive && streak > 0 && <span className="progress-hint">— rate today!</span>}
      </div>
      <div className="stats-divider" />
      <div className="stats-item">
        <span>{badge.emoji}</span>
        <div>
          <div className="stats-item" style={{ gap: 6 }}>
            <span className="stats-label" style={{ color: badge.color }}>{badge.label} Rater</span>
            <span className="progress-hint">{total} votes</span>
          </div>
          {next && (
            <div className="stats-item" style={{ marginTop: 4, gap: 6 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%`, background: badge.color }} />
              </div>
              <span className="progress-hint">{next.emoji} {next.minVotes - total} to go</span>
            </div>
          )}
          {!next && <span className="progress-hint" style={{ color: 'var(--accent-bright)' }}>Max level 👑</span>}
        </div>
      </div>
    </div>
  )
}

// ── Level Up Toast ───────────────────────────────────────────────
function LevelUpToast({ badge, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [])
  return (
    <div className="toast" style={{ background: badge.bg, border: `2px solid ${badge.color}`, boxShadow: `0 12px 48px ${badge.color}44` }}>
      <div style={{ fontSize: '2rem', marginBottom: 6 }}>{badge.emoji}</div>
      <div style={{ fontWeight: 700, color: badge.color }}>Level Up!</div>
      <div className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>
        You're now a <strong style={{ color: badge.color }}>{badge.label} Rater</strong>
      </div>
    </div>
  )
}

// ── Comments ─────────────────────────────────────────────────────
function Comments({ entryId }) {
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('comments')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at', { ascending: true })
      .limit(50)
    if (data) setComments(data)
  }

  useEffect(() => { if (open) load() }, [open, entryId])

  const submit = async () => {
    if (!text.trim()) return
    setLoading(true)
    const anonId = getAnonId()
    const { error } = await supabase.from('comments').insert([{
      entry_id: entryId,
      anon_id: anonId,
      body: text.trim(),
    }])
    if (!error) {
      setText('')
      await load()
    }
    setLoading(false)
  }

  const count = comments.length

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
        onClick={() => setOpen(o => !o)}
      >
        💬 {open ? 'Hide' : `Comments${count > 0 ? ` (${count})` : ''}`}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {comments.length === 0 && (
            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>No comments yet — be first!</p>
          )}
          {comments.map((c) => (
            <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
              <span className="text-muted" style={{ fontSize: '0.72rem', marginRight: 8 }}>
                {new Date(c.created_at).toLocaleDateString()}
              </span>
              <span>{c.body}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: '0.82rem', padding: '6px 10px' }}
              placeholder="Add a comment…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              maxLength={200}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              onClick={submit}
              disabled={loading || !text.trim()}
            >
              {loading ? '…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
function SubmitToast({ onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t) }, [])
  return (
    <div className="toast" style={{ background: '#0d2a1a', border: '2px solid #22c55e', boxShadow: '0 12px 48px #22c55e44' }}>
      <div style={{ fontSize: '2rem', marginBottom: 6 }}>🎉</div>
      <div style={{ fontWeight: 700, color: '#22c55e' }}>Entry Submitted!</div>
      <div className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>You are in this week's competition!</div>
    </div>
  )
}
function App() {
  const [page, setPage] = useState('home')
  const [levelUpBadge, setLevelUpBadge] = useState(null)
  const [showSubmitToast, setShowSubmitToast] = useState(false)

  useEffect(() => {
    const handler = (e) => setLevelUpBadge(e.detail)
    window.addEventListener('pfp_levelup', handler)
    return () => window.removeEventListener('pfp_levelup', handler)
  }, [])
useEffect(() => {
  const handler = () => setShowSubmitToast(true)
  window.addEventListener('entry_submitted', handler)
  return () => window.removeEventListener('entry_submitted', handler)
}, [])
  useEffect(() => {
    const boot = async () => {
      getAnonId()
      await syncVotesGivenFromServer()
      await syncWeekVotesForUser(getWeekNumber())
      // Detect + lock region server-side on boot
      const region = await detectRegion()
      await ensureAnonymousUser(getTotalVotesGiven(), region)
      archiveLastWeekIfNeeded()
    }
    boot()
  }, [])

  const archiveLastWeekIfNeeded = async () => {
    const week = getWeekNumber()
    const year = new Date().getFullYear()
    const lastWeek = week - 1
    const lastYear = lastWeek === 0 ? year - 1 : year

    const { data: existing } = await supabase
      .from('weekly_results')
      .select('id')
      .eq('week_number', lastWeek)
      .eq('year', lastYear)
    if (existing && existing.length > 0) return

    const { data: entries } = await supabase
      .from('entries')
      .select('*, votes(rating)')
      .eq('week_number', lastWeek)
      .eq('year', lastYear)
    if (!entries || entries.length === 0) return

    const raterCounts = await fetchAllTimeRaterCounts()
    const scored = scoreAndSortEntries(entries)
    const competing = leaderboardParticipating(scored, raterCounts)

    const top3 = competing.slice(0, 3).map((e, i) => ({
      week_number: lastWeek, year: lastYear, rank: i + 1,
      username: e.username, pfp_url: e.pfp_url, region: e.region,
      score: e.score, avg_rating: parseFloat(e.avgRating), total_votes: e.totalVotes
    }))
    await supabase.from('weekly_results').insert(top3)
  }

  return (
    <div className="app-shell">
      <div className="app-inner">
        {levelUpBadge && <LevelUpToast badge={levelUpBadge} onClose={() => setLevelUpBadge(null)} />}
        {showSubmitToast && <SubmitToast onClose={() => setShowSubmitToast(false)} />}
        <header className="header">
          <h1 className="header-brand">⚔️ PFPBattle</h1>
          <nav className="nav">
            {NAV.map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPage(id)}
                className={cn('nav-btn', page === id && 'nav-btn--active')}
              >
                {icon} {label}
              </button>
            ))}
          </nav>
        </header>
        <StreakBadgeBar />
        <div key={page}>
          {page === 'home' && <Leaderboard setPage={setPage} />}
          {page === 'swipe' && <SwipeMode />}
          {page === 'rate' && <RateFeed />}
          {page === 'upload' && <Upload />}
          {page === 'profile' && <Profile />}
        </div>
      </div>
    </div>
  )
}

function TrendingRow({ entry, label }) {
  return (
    <div className="lb-row" style={{ padding: '10px 12px' }}>
      <img src={entry.pfp_url} alt="" className="avatar avatar--sm" />
      <div className="lb-body">
        <div className="lb-name">{entry.username}</div>
        <div className="lb-region">{label}</div>
      </div>
      <div className="lb-stats">
        <div className="lb-score">{entry.score}</div>
        <div className="lb-meta">👁️ {entry.view_count || 0}</div>
      </div>
    </div>
  )
}

function Leaderboard({ setPage }) {
  const [entries, setEntries] = useState([])
  const [raterCounts, setRaterCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('global')
  const [boardTab, setBoardTab] = useState('rankings')
  const [pastChamps, setPastChamps] = useState([])

  useEffect(() => { loadEntries(); loadPastChamps() }, [])

  const loadPastChamps = async () => {
    const { data } = await supabase
      .from('weekly_results')
      .select('*')
      .eq('rank', 1)
      .order('year', { ascending: false })
      .order('week_number', { ascending: false })
      .limit(5)
    if (data) setPastChamps(data)
  }

  const loadEntries = async () => {
    const week = getWeekNumber()
    const year = new Date().getFullYear()
    const [{ data, error }, counts] = await Promise.all([
      supabase.from('entries').select('*, votes(rating)').eq('week_number', week).eq('year', year),
      fetchAllTimeRaterCounts(),
    ])
    if (!error && data) setEntries(scoreAndSortEntries(data))
    setRaterCounts(counts)
    setLoading(false)
  }

  const myRatingsGiven = getTotalVotesGiven()
  const myAnonId = getAnonId()
  const myPfpsRated = Math.max(myRatingsGiven, raterCounts[myAnonId] || 0)
  const iCanCompete = myPfpsRated >= LEADERBOARD_MIN_RATINGS_GIVEN
  const pfpsToCompete = Math.max(0, LEADERBOARD_MIN_RATINGS_GIVEN - myPfpsRated)

  const allFiltered = filter === 'global' ? entries : entries.filter((e) => e.region === filter)
  const competing = leaderboardParticipating(allFiltered, raterCounts)
  const champion = competing[0] || null
  const regions = ['global', ...new Set(entries.map((e) => e.region).filter(Boolean))]
  const trending = buildTrending(entries)

  return (
    <Page>
      <PageHeader title="🏆 Weekly Leaderboard" meta={`Week ${getWeekNumber()}`} />
      <div className="pills" style={{ marginBottom: 12 }}>
        <button type="button" className={cn('pill', boardTab === 'rankings' && 'pill--active')} onClick={() => setBoardTab('rankings')}>Rankings</button>
        <button type="button" className={cn('pill', boardTab === 'trending' && 'pill--active')} onClick={() => setBoardTab('trending')}>🔥 Trending</button>
      </div>
      <p className="page-desc">
        Global rankings below. Enter the board after you rate {LEADERBOARD_MIN_RATINGS_GIVEN} PFPs ({Math.min(myPfpsRated, LEADERBOARD_MIN_RATINGS_GIVEN)}/{LEADERBOARD_MIN_RATINGS_GIVEN}).
      </p>
      {!iCanCompete && (
        <div className="alert alert--purple">
          Rate {pfpsToCompete} more PFP{pfpsToCompete === 1 ? '' : 's'} to enter with your entry.{' '}
          <span className="link" onClick={() => setPage('rate')}>Rate now →</span>
        </div>
      )}
      {champion && (
        <div className="card card--champion">
          <div className="champion-label">👑 THIS WEEK&apos;S CHAMPION</div>
          <img src={champion.pfp_url} alt="" className="avatar avatar--lg avatar--gold" style={{ margin: '0 auto 10px' }} />
          <div className="lb-name">{champion.username}</div>
          <div className="lb-region">{champion.region}</div>
          <div className="text-gold" style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 8 }}>{champion.score} pts</div>
          <div className="lb-meta">⭐ {champion.avgRating} · {champion.totalVotes} votes</div>
        </div>
      )}
      {!loading && entries.length > 0 && !champion && (
        <div className="card card--pad alert--warn" style={{ marginBottom: 20, textAlign: 'center' }}>
          No champion yet — first competing entry wins the crown.
        </div>
      )}
      {pastChamps.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p className="page-desc mb-0">🏆 Past Champions</p>
          <div className="scroll-row" style={{ marginTop: 10 }}>
            {pastChamps.map((c, i) => (
              <div key={i} className="champ-chip">
                <img src={c.pfp_url} alt="" className="avatar avatar--sm avatar--gold" style={{ margin: '0 auto 6px' }} />
                <div className="lb-name" style={{ fontSize: '0.8rem' }}>{c.username}</div>
                <div className="text-gold" style={{ fontSize: '0.7rem' }}>Week {c.week_number}</div>
                <div className="lb-meta">{c.final_score ?? c.score} pts</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {boardTab === 'rankings' && (
        <div className="pills">
          {regions.map((r) => (
            <button key={r} type="button" onClick={() => setFilter(r)} className={cn('pill', filter === r && 'pill--active')}>{r}</button>
          ))}
        </div>
      )}
      {loading && <Loading />}
      {!loading && boardTab === 'trending' && entries.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {[
            ['👁️ Most viewed', trending.mostViewed],
            ['📈 Rising (2–20 votes)', trending.rising],
            ['🏆 Top scorers', trending.topScorers],
          ].map(([title, list]) => list.length > 0 && (
            <div key={title} style={{ marginBottom: 16 }}>
              <p className="field-label">{title}</p>
              <div className="lb-list">
                {list.map((e) => <TrendingRow key={e.id} entry={e} label={e.region} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && entries.length === 0 && (
        <div className="card card--pad state-center">
          No entries yet. <span className="link" onClick={() => setPage('upload')}>Be the first!</span>
        </div>
      )}
      {boardTab === 'rankings' && (
        <div className="lb-list">
          {allFiltered.map((entry, index) => {
            const isCompeting = canParticipateInLeaderboard(entry.anon_id, raterCounts)
            const competeRank = isCompeting ? competing.findIndex((e) => e.id === entry.id) + 1 : null
            const showMedal = isCompeting && competeRank <= 3
            const compBadge = isCompeting && competeRank > 0 ? getCompBadge(competeRank) : null
            return (
              <div
                key={entry.id}
                className={cn('lb-row', isCompeting && competeRank === 1 && 'lb-row--first', !isCompeting && 'lb-row--locked')}
                style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
              >
                <div className={cn('lb-rank', showMedal && competeRank === 1 && 'lb-rank--gold', showMedal && competeRank === 2 && 'lb-rank--silver', showMedal && competeRank === 3 && 'lb-rank--bronze')}>
                  {showMedal && competeRank === 1 ? '👑' : showMedal && competeRank === 2 ? '🥈' : showMedal && competeRank === 3 ? '🥉' : `#${index + 1}`}
                </div>
                <img src={entry.pfp_url} alt="" className={cn('avatar', 'avatar--md', isCompeting && competeRank === 1 && 'avatar--gold')} />
                <div className="lb-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="lb-name">{entry.username}</div>
                    {compBadge && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: compBadge.color, border: `1px solid ${compBadge.color}44`, borderRadius: 6, padding: '1px 6px' }}>
                        {compBadge.emoji} {compBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="lb-region">{entry.region}</div>
                  {!isCompeting && <div className="lb-tag lb-tag--lock">🔒 Rate {LEADERBOARD_MIN_RATINGS_GIVEN} PFPs to compete</div>}
                  {isCompeting && competeRank > 0 && <div className="lb-tag lb-tag--live">✓ Competing · #{competeRank}</div>}
                </div>
                <div className="lb-stats">
                  <div className="lb-score">{entry.score}</div>
                  <div className="lb-meta">⭐ {entry.avgRating} · {entry.totalVotes} votes</div>
                  <div className="lb-meta">👁️ {entry.view_count || 0}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}

function SwipeMode() {
  const [entries, setEntries] = useState([])
  const [current, setCurrent] = useState(0)
  const [swipeDir, setSwipeDir] = useState(null)
  const [loading, setLoading] = useState(true)
  const [touchStart, setTouchStart] = useState(null)
  const scrollCooldown = useRef(false)

  useEffect(() => { loadEntries() }, [])

  useEffect(() => {
    if (entries.length > 0 && entries[current]) trackView(entries[current])
  }, [current, entries])

  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault()
      if (scrollCooldown.current) return
      scrollCooldown.current = true
      setTimeout(() => { scrollCooldown.current = false }, 700)
      if (e.deltaY > 0) vote(9)
      else if (e.deltaY < 0) vote(2)
    }
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [entries, current])

  const loadEntries = async () => {
    const week = getWeekNumber()
    const year = new Date().getFullYear()
    const { entries: sorted } = await loadWeekFeedEntries(week, year)
    setEntries(sorted)
    setLoading(false)
  }

  const vote = async (rating) => {
    const entry = entries[current]
    if (!entry) return
    const result = await castVote({ entryId: entry.id, rating, week: getWeekNumber() })
    if (result.error) { alert(result.error); return }
    if (!result.skipped) recordVote()
    const dir = rating >= 6 ? 'right' : 'left'
    setSwipeDir(dir)
    setTimeout(() => { setSwipeDir(null); setCurrent(prev => prev + 1) }, 400)
  }

  const handleTouchStart = (e) => setTouchStart(e.touches[0].clientX)
  const handleTouchEnd = (e) => {
    if (!touchStart) return
    const diff = touchStart - e.changedTouches[0].clientX
    if (Math.abs(diff) > 80) { diff < 0 ? vote(8) : vote(3) }
    setTouchStart(null)
  }

  if (loading) return <Loading />
  if (entries.length === 0) return <Page><div className="state-center">No PFPs this week yet!</div></Page>
  if (current >= entries.length) return (
    <Page>
      <div className="state-center">
        <div className="state-emoji">🎉</div>
        <h3 className="page-title">You rated everyone!</h3>
        <p className="text-muted">Come back when new PFPs are added</p>
        <button type="button" className="btn btn-primary mt-16" onClick={() => setCurrent(0)}>Start Over</button>
      </div>
    </Page>
  )

  const entry = entries[current]

  return (
    <Page className="page--narrow" style={{ userSelect: 'none' }}>
      <PageHeader title="🎮 Swipe Mode" meta={`${current + 1} / ${entries.length}`} />
      <p className="page-desc" style={{ textAlign: 'center' }}>Scroll ↓ Hot · ↑ Not · Swipe on mobile</p>
      <div
        className={cn('swipe-card', swipeDir === 'right' && 'swipe-card--right', swipeDir === 'left' && 'swipe-card--left')}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {swipeDir === 'right' && <div className="swipe-stamp swipe-stamp--hot">🔥 HOT</div>}
        {swipeDir === 'left' && <div className="swipe-stamp swipe-stamp--nope">❌ NOPE</div>}
        <img src={entry.pfp_url} alt="" className="avatar avatar--hero" style={{ margin: '0 auto 16px' }} />
        <h3 className="lb-name mb-0">{entry.username}</h3>
        <p className="lb-region">{entry.region}</p>
        <div className="flex-center" style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-circle btn-circle--nope" onClick={() => vote(2)}>❌</button>
          <button type="button" className="btn btn-circle btn-circle--mid" onClick={() => vote(5)}>😐</button>
          <button type="button" className="btn btn-circle btn-circle--hot" onClick={() => vote(9)}>🔥</button>
        </div>
      </div>
      <div className="flex-wrap-center mt-16">
        {[1,2,3,4,5,6,7,8,9,10].map((num) => (
          <button key={num} type="button" className="rate-num" onClick={() => vote(num)}>{num}</button>
        ))}
      </div>
      <p className="page-desc mt-16" style={{ textAlign: 'center', lineHeight: 1.8 }}>↑ ❌ Not<br />↓ 🔥 Hot</p>
    </Page>
  )
}

function RateFeed() {
  const [entries, setEntries] = useState([])
  const [current, setCurrent] = useState(0)
  const [rated, setRated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadEntries() }, [])

  useEffect(() => {
    if (entries.length > 0 && entries[current]) trackView(entries[current])
  }, [current, entries])

  const loadEntries = async () => {
    const week = getWeekNumber()
    const year = new Date().getFullYear()
    const { entries: sorted } = await loadWeekFeedEntries(week, year)
    setEntries(sorted)
    setLoading(false)
  }

  const submitVote = async (rating) => {
    const entry = entries[current]
    const result = await castVote({ entryId: entry.id, rating, week: getWeekNumber() })
    if (result.error) { alert(result.error); return }
    if (result.skipped) { next(); return }
    recordVote()
    setRated(true)
    setTimeout(() => { setRated(false); next() }, 800)
  }

  const next = () => {
    if (current < entries.length - 1) setCurrent(current + 1)
    else setCurrent(0)
  }

  if (loading) return <Loading />
  if (entries.length === 0) return <Page><div className="state-center">No PFPs to rate yet!</div></Page>

  const entry = entries[current]

  return (
    <Page>
      <PageHeader title="⭐ Rate PFPs" meta={`${current + 1} / ${entries.length}`} />
      <div className="progress-block">
        <span className="text-muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>PFPs rated</span>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: `${Math.min((getVotesGiven() / VOTES_REQUIRED_TO_SHARE) * 100, 100)}%`,
              background: canShare() ? 'var(--success)' : 'var(--accent)',
            }}
          />
        </div>
        <span className={canShare() ? 'text-success' : ''} style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
          {Math.min(getVotesGiven(), VOTES_REQUIRED_TO_SHARE)}/{VOTES_REQUIRED_TO_SHARE}
        </span>
        {canShare() && <span className="text-success" style={{ fontSize: '0.7rem' }}>✓ Share</span>}
      </div>
      <div className={cn('card card--pad', rated && 'alert--success')} style={{ textAlign: 'center', borderWidth: rated ? 2 : 1 }}>
        <img src={entry.pfp_url} alt="" className="avatar avatar--xl" style={{ margin: '0 auto 16px' }} />
        <h3 className="lb-name mb-0">{entry.username}</h3>
        <p className="lb-region">{entry.region}</p>
        {rated ? (
          <div className="text-success" style={{ fontSize: '1.1rem', padding: 12 }}>✅ Rated!</div>
        ) : (
          <div className="flex-wrap-center" style={{ margin: '20px 0 0' }}>
            {[1,2,3,4,5,6,7,8,9,10].map((num) => (
              <button key={num} type="button" className="rate-num" onClick={() => submitVote(num)}>{num}</button>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-ghost mt-16" onClick={next}>Skip →</button>
        <Comments entryId={entry.id} />
      </div>
    </Page>
  )
}

function Upload() {
  const [username, setUsername] = useState('')
  const [region, setRegion] = useState(getLockedRegion() || '')
  const [uploadType, setUploadType] = useState('file')
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [igUrl, setIgUrl] = useState('')
  const [igLoading, setIgLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!region) detectRegion().then(setRegion)
  }, [])

  const handleImageChange = (e) => {
    const file = e.target.files[0]
    setImage(file)
    if (file) setPreview(URL.createObjectURL(file))
  }

  const fetchInstagramPFP = async () => {
    if (!igUrl) return
    const isValid = igUrl.includes('instagram.com/') || /^[a-zA-Z0-9._]{1,30}$/.test(igUrl.trim())
    if (!isValid) {
      setMessage('⚠️ Please enter a valid Instagram URL or username')
      return
    }
    setIgLoading(true)
    const match = igUrl.trim().match(/instagram\.com\/([a-zA-Z0-9._]+)/)
    const handle = match ? match[1] : igUrl.trim().replace('@', '')
    const url = `https://unavatar.io/instagram/${handle}`
    setPreview(url)
    setIgLoading(false)
    setMessage('✅ Instagram PFP loaded! Click Submit to enter.')
  }

  const handleUpload = async () => {
    if (!canShare()) {
      setMessage(`⚠️ You must rate at least ${VOTES_REQUIRED_TO_SHARE} PFPs before entering! Go to ⭐ Rate or 🎮 Swipe first.`)
      return
    }
    if (!username.trim()) { setMessage('Please enter a display name'); return }

    const week = getWeekNumber()
    const year = new Date().getFullYear()
    const { data: existing } = await supabase
      .from('entries')
      .select('id')
      .eq('username', username.trim())
      .eq('week_number', week)
      .eq('year', year)
    if (existing && existing.length > 0) {
      setMessage('⚠️ You already entered this week!')
      return
    }

    if (uploadType === 'file' && !image) { setMessage('Please select an image'); return }
    if (uploadType === 'instagram' && !preview) { setMessage('Please fetch your Instagram PFP first'); return }

    setLoading(true)
    try {
      let pfpUrl = ''

      if (uploadType === 'instagram') {
        const match = igUrl.trim().match(/instagram\.com\/([a-zA-Z0-9._]+)/)
        const handle = match ? match[1] : igUrl.trim().replace('@', '')
        pfpUrl = `https://unavatar.io/instagram/${handle}`
      } else {
        const fileExt = image.name.split('.').pop()
        const fileName = `${Date.now()}.${fileExt}`
        const { error: uploadError } = await supabase.storage.from('pfp-images').upload(fileName, image)
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('pfp-images').getPublicUrl(fileName)
        pfpUrl = urlData.publicUrl
      }

      const { data: userRow } = await supabase
        .from('anonymous_users')
        .select('locked_region')
        .eq('id', getAnonId())
        .maybeSingle()
      const finalRegion = userRow?.locked_region || region || 'Other'

      const { error: entryError } = await supabase.from('entries').insert([{
        username: username.trim(),
        pfp_url: pfpUrl,
        region: finalRegion,
        week_number: getWeekNumber(),
        year: new Date().getFullYear(),
        anon_id: getAnonId(),
      }])
      if (entryError) throw entryError

      await ensureAnonymousUser(getTotalVotesGiven(), finalRegion)
      setMessage('✅ You are in this week\'s competition!')
      window.dispatchEvent(new CustomEvent('entry_submitted'))

      setUsername(''); setImage(null); setPreview(null); setIgUrl('')
    } catch (err) { setMessage('❌ ' + err.message) }
    setLoading(false)
  }

  return (
    <Page>
      <PageHeader title="📤 Enter This Week" meta={`Week ${getWeekNumber()}`} />
      <p className="page-desc">
        Enter leaderboard after you rate {LEADERBOARD_MIN_RATINGS_GIVEN} PFPs ({Math.min(getTotalVotesGiven(), LEADERBOARD_MIN_RATINGS_GIVEN)}/{LEADERBOARD_MIN_RATINGS_GIVEN}).
      </p>
      <div className="toggle-row">
        <button type="button" className={cn('toggle-btn', uploadType === 'file' && 'toggle-btn--active')} onClick={() => { setUploadType('file'); setPreview(null); setMessage('') }}>📁 Upload</button>
        <button type="button" className={cn('toggle-btn', uploadType === 'instagram' && 'toggle-btn--active')} onClick={() => { setUploadType('instagram'); setPreview(null); setMessage('') }}>📸 Instagram</button>
      </div>
      {preview && (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          {uploadType === 'instagram' ? (
            <div style={{ width: 100, height: 100, margin: '0 auto', borderRadius: '50%', background: 'var(--bg-card)', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
              📸
            </div>
          ) : (
            <img src={preview} alt="" className="avatar" style={{ width: 100, height: 100, margin: '0 auto', borderColor: 'var(--accent)' }} />
          )}
          <p className="text-success" style={{ fontSize: '0.8rem', marginTop: 8 }}>✅ PFP ready</p>
        </div>
      )}
      <div className="form-stack card card--pad">
        {uploadType === 'instagram' && (
          <div>
            <p className="field-label">Instagram Profile URL</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={igUrl}
                onChange={(e) => setIgUrl(e.target.value)}
                placeholder="https://www.instagram.com/cristiano"
              />
              <button type="button" className="btn btn-primary" onClick={fetchInstagramPFP} disabled={igLoading}>
                {igLoading ? '…' : 'Fetch'}
              </button>
            </div>
            <p className="progress-hint" style={{ marginTop: 6 }}>Paste your Instagram profile link</p>
          </div>
        )}
        {uploadType === 'file' && (
          <div>
            <p className="field-label">Your PFP Image</p>
            <input className="input" type="file" accept="image/*" onChange={handleImageChange} />
          </div>
        )}
        <div>
          <p className="field-label">Display Name</p>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. aryan_k" />
        </div>
        <div>
          <p className="field-label">Region 🔒</p>
          {region
            ? <p className="alert alert--purple" style={{ margin: 0 }}>Auto-detected: <strong>{region}</strong></p>
            : <p className="text-muted" style={{ fontSize: '0.85rem' }}>Detecting your location…</p>
          }
        </div>
        {message && (
          <p className={message.includes('✅') ? 'text-success' : ''} style={{ color: message.includes('✅') ? undefined : 'var(--danger)' }}>
            {message}
          </p>
        )}
        <button type="button" className="btn btn-primary w-full" onClick={handleUpload} disabled={loading}>
          {loading ? 'Uploading…' : '🚀 Submit Entry'}
        </button>
      </div>
    </Page>
  )
}

function ShareCard({ entry, rank, globalTopPercent, onClose }) {
  const cardRef = useRef(null)

  const renderCardImage = async () => {
    if (!cardRef.current) return null
    const canvas = await html2canvas(cardRef.current, { backgroundColor: '#0f0f0f', scale: 2, useCORS: true })
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  const download = async () => {
    const blob = await renderCardImage()
    if (!blob) return
    const link = document.createElement('a')
    link.download = `pfpbattle-rank${rank}.png`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const shareNative = async () => {
    const blob = await renderCardImage()
    if (!blob) return
    const text = `⭐ ${entry.avgRating}/10 on PFPBattle — Rank #${rank} in ${entry.region}${globalTopPercent != null ? ` · Top ${globalTopPercent}% globally` : ''}`
    if (navigator.share) {
      try {
        const file = new File([blob], `pfpbattle-rank${rank}.png`, { type: 'image/png' })
        const payload = navigator.canShare?.({ files: [file] })
          ? { title: 'PFPBattle', text, files: [file] }
          : { title: 'PFPBattle', text, url: 'https://pfpbattle.vercel.app' }
        await navigator.share(payload)
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    download()
  }

  const compBadge = getCompBadge(rank)

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div ref={cardRef} className="share-card-inner">
          <div className="champion-label" style={{ color: 'var(--accent-bright)' }}>⚔️ PFPBATTLE</div>
          <img src={entry.pfp_url} alt="" crossOrigin="anonymous" className="avatar avatar--lg avatar--gold" style={{ margin: '0 auto 16px' }} />
          <div className="lb-name">@{entry.username}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gold)', margin: '8px 0' }}>⭐ {entry.avgRating}/10</div>
          <div className="lb-region">{entry.region}</div>
          {compBadge && (
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: compBadge.color, margin: '6px 0' }}>
              {compBadge.emoji} {compBadge.label}
            </div>
          )}
          {globalTopPercent != null && (
            <div style={{ fontWeight: 700, color: '#67e8f9', margin: '12px 0' }}>Top {globalTopPercent}% globally</div>
          )}
          <div style={{ display: 'inline-block', background: 'linear-gradient(135deg,#fbbf24,#d97706)', color: '#1a0533', fontSize: '1.2rem', fontWeight: 700, padding: '10px 24px', borderRadius: 12, margin: '16px 0' }}>
            {rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅'} Rank #{rank} in {entry.region}
          </div>
          <div className="flex-center" style={{ marginBottom: 16 }}>
            {[['Score', entry.score], ['Avg', entry.avgRating], ['Votes', entry.totalVotes]].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div className="lb-score">{val}</div>
                <div className="lb-meta">{label}</div>
              </div>
            ))}
          </div>
          <div className="lb-meta">Week {getWeekNumber()} · {new Date().getFullYear()}</div>
          <div style={{ color: 'var(--accent-bright)', fontWeight: 600, fontSize: '0.8rem', marginTop: 8 }}>pfpbattle.vercel.app</div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={shareNative}>📤 Share</button>
          <button type="button" className="btn btn-ghost" onClick={download}>📥 Save</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
      </div>
    </div>
  )
}

function Profile() {
  const [username, setUsername] = useState('')
  const [savedUsername, setSavedUsername] = useState(localStorage.getItem('my_username') || '')
  const [stats, setStats] = useState(null)
  const [searched, setSearched] = useState(false)
  const [shareEntry, setShareEntry] = useState(null)
  const [shareRank, setShareRank] = useState(null)
  const [shareGlobalPercent, setShareGlobalPercent] = useState(null)
  const [votesGiven, setVotesGiven] = useState(getVotesGiven())
  const [lifetime, setLifetime] = useState(null)

  const totalVotesGiven = getTotalVotesGiven()
  const streak = getStreak()
  const alive = isStreakAlive()
  const badge = getBadge(totalVotesGiven)
  const nextBadge = getNextBadge(totalVotesGiven)
  const badgeProgress = nextBadge ? ((totalVotesGiven - badge.minVotes) / (nextBadge.minVotes - badge.minVotes)) * 100 : 100

  useEffect(() => {
    const loadMyProfile = async () => {
      const anonId = getAnonId()
      const { data } = await supabase
        .from('entries')
        .select('*, votes(rating)')
        .eq('anon_id', anonId)
        .order('year', { ascending: false })
        .order('week_number', { ascending: false })
      if (data?.length) {
        const name = data[0].username
        setUsername(name)
        setSavedUsername(name)
        localStorage.setItem('my_username', name)
        applyStats(data)
        return
      }
      if (savedUsername) {
        setUsername(savedUsername)
        searchByUsername(savedUsername)
      }
    }
    loadMyProfile()
  }, [])

  const searchByUsername = async (name) => {
    if (!name) return
    const { data, error } = await supabase.from('entries').select('*, votes(rating)').ilike('username', name.trim())
    if (error || !data) return
    applyStats(data)
  }

  const applyStats = async (data) => {
    const totalWeeks = data.length
    let bestScore = 0, totalVotesReceived = 0, bestRating = 0, totalViews = 0
    const weeks = data.map(entry => {
      const scored = scoreAndSortEntries([entry])[0]
      if (scored.score > bestScore) bestScore = scored.score
      if (scored.avgRatingNum > bestRating) bestRating = scored.avgRatingNum
      totalVotesReceived += scored.totalVotes
      totalViews += entry.view_count || 0
      return { ...entry, week: entry.week_number, year: entry.year, score: scored.score, avgRating: scored.avgRating, totalVotes: scored.totalVotes }
    })
    weeks.sort((a, b) => b.week - a.week)
    const name = data[0]?.username || username
    const life = await computeLifetimeStats(name)
    setLifetime(life)
    setStats({ totalWeeks, bestScore, totalVotesReceived, bestRating: bestRating.toFixed(1), totalViews, weeks })
    setSearched(true)
  }

  const search = async () => {
    if (!username) return
    localStorage.setItem('my_username', username.trim())
    setSavedUsername(username.trim())
    searchByUsername(username.trim())
  }

  const handleShare = async (weekEntry) => {
    if (!canShare()) {
      alert(`⚠️ You need to rate at least ${VOTES_REQUIRED_TO_SHARE} PFPs before sharing! Go to Rate or Swipe mode.`)
      return
    }
    const week = weekEntry.week_number || weekEntry.week
    const year = weekEntry.year
    const [{ data }, raterCounts] = await Promise.all([
      supabase.from('entries').select('*, votes(rating)').eq('week_number', week).eq('year', year),
      fetchAllTimeRaterCounts(),
    ])
    if (!data) return
    const scored = scoreAndSortEntries(data)
    const entry = scored.find((e) => e.username === username)
    if (!entry) return
    if (!canParticipateInLeaderboard(entry.anon_id, raterCounts)) {
      const need = LEADERBOARD_MIN_RATINGS_GIVEN - getTotalVotesGiven()
      alert(`Rate ${Math.max(need, 1)} more PFP${need === 1 ? '' : 's'} to enter the leaderboard, then share your rank.`)
      return
    }
    const competing = leaderboardParticipating(scored, raterCounts)
    const rank = competing.findIndex((e) => e.id === entry.id) + 1
    if (rank === 0) return
    setShareEntry(entry)
    setShareRank(rank)
    setShareGlobalPercent(calcGlobalTopPercent(scored, entry, raterCounts))
  }

  // Compute competition streak from week history
  const compStreak = (() => {
    if (!lifetime?.weekRanks) return 0
    let streak = 0
    for (const rank of lifetime.weekRanks) {
      if (rank <= 10) streak++
      else break
    }
    return streak
  })()

  const winStreak = (() => {
    if (!lifetime?.weekRanks) return 0
    let streak = 0
    for (const rank of lifetime.weekRanks) {
      if (rank === 1) streak++
      else break
    }
    return streak
  })()

  return (
    <Page>
      <PageHeader title="👤 Profile" />
      <div className="stat-grid">
        <div className="badge-panel" style={{ background: badge.bg, borderColor: `${badge.color}44` }}>
          <div style={{ fontSize: '2rem' }}>{badge.emoji}</div>
          <div style={{ fontWeight: 700, color: badge.color }}>{badge.label} Rater</div>
          <div className="progress-hint">{totalVotesGiven} PFPs rated</div>
          {nextBadge && (
            <>
              <div className="progress-track" style={{ margin: '8px 0 4px' }}>
                <div className="progress-fill" style={{ width: `${badgeProgress}%`, background: badge.color }} />
              </div>
              <div className="progress-hint">{nextBadge.emoji} {nextBadge.minVotes - totalVotesGiven} to {nextBadge.label}</div>
            </>
          )}
        </div>
        <div className="badge-panel" style={{ background: alive ? 'rgba(251,146,60,0.08)' : 'var(--bg-card)', borderColor: alive ? 'rgba(251,146,60,0.3)' : 'var(--border)' }}>
          <div style={{ fontSize: '2rem' }}>{alive ? '🔥' : '💤'}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: alive ? '#fb923c' : 'var(--text-dim)' }}>{streak}</div>
          <div className="stats-label--hot" style={{ fontSize: '0.8rem' }}>day streak</div>
          <div className="progress-hint" style={{ marginTop: 6 }}>{alive ? 'Keep it going!' : 'Rate today!'}</div>
        </div>
      </div>

      {/* Competition streaks */}
      {(compStreak > 0 || winStreak > 0) && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          {winStreak > 0 && (
            <div className="badge-panel" style={{ background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.3)' }}>
              <div style={{ fontSize: '1.5rem' }}>👑</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fbbf24' }}>{winStreak}</div>
              <div className="progress-hint">win streak</div>
            </div>
          )}
          {compStreak > 0 && (
            <div className="badge-panel" style={{ background: 'rgba(244,114,182,0.08)', borderColor: 'rgba(244,114,182,0.3)' }}>
              <div style={{ fontSize: '1.5rem' }}>🔟</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f472b6' }}>{compStreak}</div>
              <div className="progress-hint">Top 10 streak</div>
            </div>
          )}
        </div>
      )}

      <div className="card card--pad" style={{ marginBottom: 20 }}>
        <p className="field-label mb-0">🏅 Rater Badge Levels</p>
        <div className="flex-center" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          {BADGES.map((b) => {
            const unlocked = totalVotesGiven >= b.minVotes
            return (
              <div key={b.id} style={{ textAlign: 'center', opacity: unlocked ? 1 : 0.35, flex: 1 }}>
                <div style={{ fontSize: '1.25rem' }}>{b.emoji}</div>
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: unlocked ? b.color : 'var(--text-dim)' }}>{b.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card card--pad" style={{ marginBottom: 20 }}>
        <p className="field-label mb-0">🏆 Competitor Badges</p>
        <div className="flex-center" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          {COMP_BADGES.map((b) => {
            const unlocked = lifetime?.bestRank != null && lifetime.bestRank >= b.minRank && lifetime.bestRank <= b.maxRank
            return (
              <div key={b.id} style={{ textAlign: 'center', opacity: unlocked ? 1 : 0.35, flex: 1 }}>
                <div style={{ fontSize: '1.25rem' }}>{b.emoji}</div>
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: unlocked ? b.color : 'var(--text-dim)' }}>{b.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={cn('progress-block', canShare() && 'alert--success')}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }} className={canShare() ? 'text-success' : 'text-muted'}>
            {canShare() ? '✅ Share unlocked' : `🔒 Rate ${VOTES_REQUIRED_TO_SHARE - votesGiven} more PFPs to share`}
          </p>
          <div className="progress-track" style={{ marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${Math.min((votesGiven / VOTES_REQUIRED_TO_SHARE) * 100, 100)}%`, background: canShare() ? 'var(--success)' : 'var(--accent)' }} />
          </div>
        </div>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>{Math.min(votesGiven, VOTES_REQUIRED_TO_SHARE)}/{VOTES_REQUIRED_TO_SHARE}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input className="input" style={{ flex: 1 }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter username" onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button type="button" className="btn btn-primary" onClick={search}>Search</button>
      </div>
      {savedUsername && (
        <p className="progress-hint" style={{ marginTop: -12, marginBottom: 16 }}>
          Showing: <span style={{ color: 'var(--accent-bright)' }}>{savedUsername}</span> ·{' '}
          <span className="link" style={{ color: 'var(--danger)' }} onClick={() => { localStorage.removeItem('my_username'); setSavedUsername(''); setUsername(''); setStats(null); setSearched(false) }}>Change</span>
        </p>
      )}
      {searched && !stats?.totalWeeks && <div className="state-center">No entries for &quot;{username}&quot;</div>}
      {lifetime && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[['🥇 Wins', lifetime.winsCount], ['🔟 Top 10s', lifetime.top10Count], ['💯 Top 100s', lifetime.top100Count], ['🏅 Best rank', lifetime.bestRank ? `#${lifetime.bestRank}` : '—']].map(([label, val]) => (
            <div key={label} className="stat-card">
              <div className="stat-value">{val}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}
      {stats && stats.totalWeeks > 0 && (
        <>
          <div className="stat-grid">
            {[['Weeks', stats.totalWeeks], ['Votes', stats.totalVotesReceived], ['Views', stats.totalViews || 0], ['Best', stats.bestScore], ['Rating', stats.bestRating + '/10']].map(([label, val]) => (
              <div key={label} className="stat-card">
                <div className="stat-value">{val}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>
          <div className="card card--pad">
            <p className="field-label">Week history</p>
            {stats.weeks.map((w, i) => (
              <div key={i} className="lb-row" style={{ padding: '12px 0', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0, margin: 0 }}>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>Week {w.week}, {w.year}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="lb-score" style={{ fontSize: '0.85rem' }}>{w.score} · ⭐{w.avgRating}</span>
                  <button type="button" className={cn('btn', canShare() ? 'btn-primary' : 'btn-ghost')} style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => handleShare(w)}>
                    {canShare() ? '📤' : '🔒'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {shareEntry && (
        <ShareCard entry={shareEntry} rank={shareRank} globalTopPercent={shareGlobalPercent} onClose={() => { setShareEntry(null); setShareRank(null); setShareGlobalPercent(null) }} />
      )}
    </Page>
  )
}

export default App
