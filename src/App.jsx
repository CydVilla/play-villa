import { useEffect, useState } from 'react'
import CalendarIntegration from './components/CalendarIntegration'
import CountdownTimer from './components/CountdownTimer'
import './App.css'

const api = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''
const community = import.meta.env.VITE_COMMUNITY_NAME?.trim() || 'Play Villa'
const invite = import.meta.env.VITE_DISCORD_INVITE
const donation = import.meta.env.VITE_DONATION_URL
const amazon = import.meta.env.VITE_AMAZON_STORE_ID

const date = (seconds) => new Date(seconds * 1000).toISOString()
const discord = (item, channel = item.channel_id, message = '') =>
  `https://discord.com/channels/${item.guild_id}/${channel}${message ? `/${message}` : ''}`

function showTime(seconds) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(seconds * 1000)
}

function Time({ at }) {
  return <time dateTime={date(at)}>{showTime(at)}</time>
}

function External({ children, href, sponsored = false, className }) {
  return <a className={className} href={href} target="_blank" rel={`noopener noreferrer${sponsored ? ' sponsored' : ''}`}>{children}</a>
}

function purchase(game) {
  if (!amazon || !game) return null
  return `https://www.amazon.com/s?${new URLSearchParams({ k: `${game.name} video game`, tag: amazon })}`
}

function GameTile({ game }) {
  const tags = game?.tags
  return (
    <li className="game-tile">
      {game.image && <img src={game.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span>{game.name}{tags && <small className="game-tags">{tags}</small>}</span><span className="metric">{game.votes} {game.votes === 1 ? 'vote' : 'votes'}</span>
    </li>
  )
}

function Attribution({ sessions }) {
  if (!sessions.some(item => item.games.some(game => game.rawg_id))) return null
  return <p className="source">Game data and artwork by <External href="https://rawg.io/">RAWG</External>.</p>
}

function Session({ item }) {
  const game = item.games.find(game => game.id === item.game_id)
  const confirmed = item.status === 'confirmed'
  const open = item.status === 'open'
  const where = item.voice_id ? discord(item, item.voice_id) : discord(item)
  const calendar = confirmed ? {
    id: item.id, start: item.starts_at, duration: item.duration, decidedAt: item.decided_at, revision: item.revision,
    summary: `${community} · ${game?.name ?? item.title}`, description: item.description, location: where,
  } : null
  const store = purchase(game)
  const tags = game?.tags
  return (
    <article className={`session ${confirmed ? 'session-confirmed' : ''}`}>
      <header className="session-heading">
        <p className="status">{confirmed ? (item.revision ? 'Rescheduled' : 'Confirmed') : open ? 'Voting open' : 'Awaiting confirmation'}</p>
        <h3>{confirmed && game ? game.name : item.title}</h3>
        {confirmed && <p className="event-date"><Time at={item.starts_at} /> · {item.duration} min</p>}
        {confirmed && game?.votes > 0 && <p className="muted">{game.votes} {game.votes === 1 ? 'vote' : 'votes'} in the poll</p>}
        {confirmed && tags && <p className="game-tags">{tags}</p>}
        {item.description && <p className="description">{item.description}</p>}
      </header>
      {confirmed && game?.image && <img className="winner-art" src={game.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      {open && <CountdownTimer endTime={item.deadline} />}
      {!confirmed && (
        <div className="poll-grid">
          <section>
            <h4>Nominations</h4>
            {item.games.length ? <ul className="tallies">{item.games.map(game => <GameTile key={game.id} game={game} />)}</ul>
              : <p className="muted">Nominate a game in Discord.</p>}
          </section>
          <section>
            <h4>Availability</h4>
            <ul className="tallies">
              {item.slots.map(slot => (
                <li key={slot.starts_at} className="slot"><Time at={slot.starts_at} /><span className="metric">{slot.available} available</span></li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <p className="attendance">
        {item.response_counts.going}{item.capacity ? `/${item.capacity}` : ''} going
        {' · '}{item.response_counts.maybe} maybe{' · '}{item.response_counts.declined} can’t attend
        {item.waiting > 0 && ` · ${item.waiting} on waitlist`}
        {item.response_counts.reconfirm > 0 && ` · ${item.response_counts.reconfirm} to reconfirm`}
      </p>
      <div className="session-actions">
        <External className="action" href={discord(item, item.channel_id, item.message_id)}>Open in Discord ↗</External>
        {confirmed && item.event_id && <External className="action secondary" href={`https://discord.com/events/${item.guild_id}/${item.event_id}`}>Open Discord Event ↗</External>}
        {confirmed && item.voice_id && <External className="action secondary" href={where}>Join voice ↗</External>}
        {store && <External className="action secondary" href={store} sponsored>Find on Amazon ↗</External>}
      </div>
      {calendar && <CalendarIntegration event={calendar} />}
    </article>
  )
}

function History({ sessions }) {
  if (!sessions.length) return null
  return (
    <section id="history" className="archive" aria-labelledby="history-label">
      <h2 id="history-label">Past game nights</h2>
      <p className="muted">Organizers can use <code>/gamenight rematch</code> in Discord to play one again.</p>
      <ul className="history-list">
        {sessions.map(item => {
          const game = item.games.find(game => game.id === item.game_id)
          const store = purchase(game)
          return (
            <li key={item.id}>
              {game?.image && <img src={game.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
              <div><h3>{game?.name ?? item.title}</h3><Time at={item.starts_at} /></div>
              {store && <External href={store} sponsored>Amazon ↗</External>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function App() {
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function refresh() {
      try {
        const result = await fetch(`${api}/api/schedule`, { signal: controller.signal })
        if (result.status === 404) {
          setError('A public schedule has not been configured for this site.')
          return
        }
        if (!result.ok) throw new Error()
        const body = await result.json()
        if (!Array.isArray(body.sessions)) throw new Error()
        setSessions(body.sessions)
        setError('')
      } catch {
        if (!controller.signal.aborted) setError('The schedule is temporarily unavailable. Check Discord for the latest plans.')
      }
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  const active = sessions?.filter(item => !item.past) ?? []
  const past = sessions?.filter(item => item.past) ?? []
  return (
    <div className="app-shell">
      <a className="skip" href="#schedule">Skip to schedule</a>
      <header className="vhs-header">
        <div>
          <p className="community">{community}</p>
          <h1>Game Nights</h1>
        </div>
        {invite && <External className="action" href={invite}>Join Discord ↗</External>}
      </header>
      <main id="schedule">
        <h2>Schedule</h2>
        {error && <p className="empty" role="status">{error}</p>}
        {!sessions && !error && <p className="empty" role="status">Loading game nights…</p>}
        {sessions && !active.length && !error && <p className="empty">No upcoming game nights. New rounds will appear here.</p>}
        <div className="session-list">{active.map(item => <Session key={item.id} item={item} />)}</div>
        <History sessions={past} />
        <Attribution sessions={sessions ?? []} />
      </main>
      <footer>
        <External href="https://github.com/CydVilla/play-villa">Source on GitHub ↗</External>
        {donation && <External href={donation}>Donate ↗</External>}
        {amazon && <small>As an Amazon Associate this site earns from qualifying purchases.</small>}
      </footer>
    </div>
  )
}
