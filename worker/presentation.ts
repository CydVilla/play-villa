import { channelLink, escapeText, timestamp, type Message } from './discord-api.ts'
import { partyLabel } from './party.ts'
import { recommend, type Details } from './store.ts'
import type { CreateDraft, Delivery, Game, GameDetails, Session } from './types.ts'

const button = (custom_id: string, label: string, style = 2) => ({ type: 2, style, custom_id, label })
const row = (...components: Record<string, unknown>[]) => ({ type: 1, components })
const key = (action: string, item: Session) => `gn:${action}:${item.id}${item.revision ? `:${item.revision}` : ''}`
const label = (slice: string, max = 100) => slice.length > max ? `${slice.slice(0, max - 1)}…` : slice

export function gameDetailsText(details: GameDetails) {
  return [
    details.platforms?.length && `**Platforms** ${escapeText(details.platforms.join(', '))}`,
    details.genres?.length && `**Genres** ${escapeText(details.genres.join(', '))}`,
    details.released && `**Released** ${details.released}`,
    details.publisher && `**Publisher** ${escapeText(details.publisher)}`,
    details.notes && `**Game note** ${escapeText(details.notes)}`,
    details.sourceUrl && `[Game page on RAWG](${details.sourceUrl})`,
  ].filter(Boolean).join('\n')
}

export function createPreview(id: string, draft: CreateDraft, expires: number): Message {
  const { catalog } = draft
  const lines = [
    catalog ? `**RAWG match** ${escapeText(catalog.name)}` : `**Game title** ${escapeText(draft.title)}`,
    catalog ? gameDetailsText(catalog.details) : 'Play Villa couldn’t verify a single RAWG match. Check the title or publish it as typed.',
    catalog && !catalog.details.sourceUrl && '[Game data by RAWG](https://rawg.io/)',
    draft.platforms && draft.platforms !== '[]' && `**Your platforms** ${partyLabel({ platforms: draft.platforms, crossplay: null, min_players: null, max_players: null })}`,
    draft.notes && `**Your note** ${escapeText(draft.notes)}`,
    '',
    `**Proposed times** ${draft.slots.map(slot => timestamp(slot, 'F')).join(' • ')}`,
    `**Voting closes** ${timestamp(draft.deadline)}`,
    `**Seats** ${draft.capacity ?? 'No limit'}`,
    draft.description && escapeText(draft.description),
  ]
  return {
    content: `Review the game and time before publishing. This preview expires ${timestamp(expires, 'R')}.`,
    embeds: [{ title: 'Review game night', description: lines.filter(line => typeof line === 'string').join('\n') }],
    components: [row(
      ...(catalog ? [button(`gn:publish-catalog:${id}`, 'Publish with RAWG match', 1)] : []),
      button(`gn:publish-typed:${id}`, 'Publish as typed', catalog ? 2 : 1),
      button(`gn:discard-draft:${id}`, 'Discard preview', 4),
    )],
  }
}

export function rawgResults(games: { id: number; name: string; details: GameDetails }[], target: Session | 'none' | 'choose'): Message {
  const preview = (details: GameDetails) =>
    [details.platforms?.join(', '), details.genres?.join(', '), details.released].filter(Boolean).join(' · ')
  const results = games.map(game => {
    const summary = preview(game.details)
    const source = game.details.sourceUrl ? ` · [RAWG page](${game.details.sourceUrl})` : ''
    return `**${escapeText(game.name)}** · ID \`${game.id}\`${source}${summary ? `\n${escapeText(label(summary, 120))}` : ''}`
  })
  const item = typeof target === 'object' ? target : null
  const instructions = item ? `Choose a result to nominate for **${escapeText(item.title)}**.`
    : target === 'none' ? 'There’s no open game night in this channel. An organizer can start one with `/gamenight create`.'
    : 'More than one game night is open. Choose a **session** when you search, or use a result ID with `/gamenight nominate`.'
  return {
    content: `${instructions} [Game data by RAWG](https://rawg.io/)`,
    embeds: [{ description: results.join('\n\n') }],
    components: item ? [row({
      type: 3, custom_id: key('rawg', item), placeholder: 'Choose a game to nominate',
      options: games.map(game => ({
        label: game.name, value: String(game.id), description: label(preview(game.details)) || undefined,
      })),
    })] : undefined,
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

// Member tags win. Otherwise list up to four RAWG platforms so every game shows where it runs.
export function gameTags(game: Game) {
  const tagged = partyLabel(game)
  if ((JSON.parse(game.platforms) as string[]).length) return tagged
  const rawg = (JSON.parse(game.game_details) as GameDetails).platforms ?? []
  const listed = rawg.length > 4 ? `${rawg.slice(0, 4).join(', ')} +${rawg.length - 4}` : rawg.join(', ')
  return [escapeText(listed), tagged].filter(Boolean).join(' · ')
}

function meter(value: number, max: number, width = 6) {
  const filled = max > 0 ? Math.round(value / max * width) : 0
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const isLive = (item: Session, at: number) => item.status === 'open' && item.deadline > at

function controls(item: Session, at: number, delivery?: Delivery) {
  if (isLive(item, at)) return [row(button(key('ballot', item), 'Vote & pick times', 1), button(key('surprise', item), '🎲 Surprise me'))]
  if (item.status !== 'confirmed') return []
  const rsvp = [button(key('going', item), 'Going', 3), button(key('maybe', item), 'Maybe'), button(key('declined', item), 'Can’t attend', 4)]
  // Reminders are snapshots. The live board and View details show current attendance.
  return [row(...rsvp, ...(delivery?.kind === 'reminder' ? [button(key('show', item), 'View details')] : []))]
}

export interface MyBallot {
  vote: number | null
  times: number[]
}

// One private panel holds both choices. Each change updates this panel in place.
export function ballot(data: Details, mine: MyBallot, notice = ''): Message {
  const { item, games, slots } = data
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: item.timezone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
  const myGame = games.find(game => game.id === mine.vote)
  const single = slots.length === 1
  const lines = [
    notice,
    `**Your vote** ${myGame ? escapeText(myGame.name) : 'Not voted yet'}`,
    `**Your times** ${mine.times.length ? single ? 'You can make it' : `${mine.times.length} of ${slots.length}` : 'None picked yet'}`,
    single && `\n**Time** ${timestamp(slots[0].starts_at, 'F')} · ${slots[0].available} available`,
    slots.length > 1 && `\n**Times** in your time zone. The dropdown shows ${item.timezone}; the numbers match.`,
    ...(single ? [] : slots.map((slot, index) => `${index + 1}. ${timestamp(slot.starts_at, 'F')} · ${slot.available} available`)),
    `Voting closes ${timestamp(item.deadline, 'R')}. Don’t see your game or time? Suggest one below.`,
  ].filter(line => typeof line === 'string' && line)
  const components = []
  if (games.length) components.push(row({
    type: 3, custom_id: key('vote', item), placeholder: 'Vote for a game',
    options: [
      ...games.map(game => ({
        label: label(game.name), value: String(game.id), default: mine.vote === game.id,
        description: label([plural(game.votes, 'vote'), gameTags(game).replace(/\\/g, '')].filter(Boolean).join(' · ')),
      })),
      ...(mine.vote !== null ? [{ label: 'Retract my vote', value: 'none' }] : []),
    ],
  }))
  if (slots.length) components.push(row({
    type: 3, custom_id: key('times', item), placeholder: single ? 'Can you make this time?' : 'Pick every time you can make',
    min_values: 0, max_values: slots.length,
    options: slots.map((slot, index) => ({
      label: `${single ? '' : `${index + 1}. `}${local.format(slot.starts_at * 1000)}`,
      value: String(slot.starts_at),
      default: mine.times.includes(slot.starts_at),
    })),
  }))
  components.push(row(
    ...(games.length < 24 ? [button(key('suggest-game', item), 'Suggest a game')] : []),
    ...(slots.length < 10 ? [button(key('suggest-time', item), 'Suggest a time')] : []),
  ))
  if (!games.length) lines.push('No games yet. Use **Suggest a game** to add one.')
  if (!(components.at(-1)?.components as unknown[]).length) components.pop()
  return { content: lines.join('\n'), components }
}

const input = (custom_id: string, label: string, placeholder: string, max_length: number, required = false, style = 1) =>
  row({ type: 4, custom_id, label, placeholder, max_length, required, style })

// Opened from the private panel; the submission updates that panel in place.
export function suggestionForm(kind: 'game' | 'time', sessionKey: string, timezone: string) {
  return kind === 'game' ? {
    custom_id: `gn:add-game:${sessionKey}`,
    title: 'Suggest a game',
    components: [
      input('name', 'Game', 'Exact title, e.g. Deep Rock Galactic', 100, true),
      input('platforms', 'Platforms (optional)', 'PC, Xbox, PlayStation, Switch, Mobile', 100),
      input('notes', 'Note (optional)', 'Where to get it, price, mods, anything else', 200, false, 2),
    ],
  } : {
    custom_id: `gn:add-time:${sessionKey}`,
    title: 'Suggest a time',
    components: [
      input('day', 'Day', 'Sat, tomorrow, Nov 29 or 11/29', 30, true),
      input('time', `Time (${timezone})`.slice(0, 45), '8 PM or 20:30', 20, true),
    ],
  }
}

export function board(data: Details, at: number, delivery?: Delivery): Message {
  const { item, games, slots, going, rsvps, waiting, eventId, voters, available } = data
  const selected = games.find(game => game.id === item.game_id)
  const status = item.status === 'open' && at >= item.deadline ? 'closed' : item.status
  const isBallot = status === 'open' || status === 'closed'
  const proposal = recommend(data, at)
  const suggestedGame = item.status === 'open' ? proposal.game : selected
  const suggestedTime = item.status === 'open' ? proposal.slot?.starts_at : item.starts_at
  const featuredGame = isBallot ? suggestedGame ?? games[0] : status === 'confirmed' ? selected : undefined
  const gameDetails = featuredGame && gameDetailsText(JSON.parse(featuredGame.game_details) as GameDetails)
  const memberTags = featuredGame && partyLabel(featuredGame)
  const lead = status === 'open' ? 'Leading' : 'Recommended'
  const mostVotes = Math.max(0, ...games.map(game => game.votes))
  const mostAvailable = Math.max(0, ...slots.map(slot => slot.available))
  const shownGames = games.slice(0, 10)
  const highlights = [
    item.description && escapeText(item.description),
    status === 'open' && `**Voting closes** ${timestamp(item.deadline, 'R')} · ${voters} voted · ${available === 1 ? '1 picked a time' : `${available} picked times`}`,
    status === 'closed' && 'Voting is closed. An organizer can confirm the night.',
    status === 'cancelled' && 'This game night was cancelled.',
    delivery?.kind === 'rescheduled' && 'The start time changed. Please RSVP again on this board.',
    status === 'confirmed' && item.starts_at && selected &&
      `**${escapeText(selected.name)}** • ${timestamp(item.starts_at, 'F')}`,
    isBallot && `**${lead} game** ${suggestedGame ? escapeText(suggestedGame.name) : 'No votes yet'}`,
    isBallot && `**${lead} time** ${suggestedTime ? timestamp(suggestedTime) : 'No times picked yet'}`,
    isBallot && shownGames.length > 0 && '\n**Games**',
    ...(isBallot ? shownGames.map(game => {
      const tags = gameTags(game)
      return `${meter(game.votes, mostVotes)} **${escapeText(game.name)}** · ${plural(game.votes, 'vote')}${tags ? ` · ${tags}` : ''}`
    }) : []),
    isBallot && games.length > shownGames.length && `…and ${games.length - shownGames.length} more in the vote menu.`,
    isBallot && slots.length > 0 && '\n**Times** (shown in your time zone)',
    ...(isBallot ? slots.map(slot => `${meter(slot.available, mostAvailable)} ${timestamp(slot.starts_at)} · ${slot.available} available`) : []),
    featuredGame && (gameDetails || memberTags) && `\n**About ${escapeText(featuredGame.name)}**`,
    memberTags && `**Tags** ${memberTags}`,
    gameDetails,
    status === 'open' && featuredGame && !gameDetails && !memberTags &&
      `\nNo details for **${escapeText(featuredGame.name)}** yet. Whoever suggested it, or an organizer, can add platforms and a note with \`/gamenight tag\`.`,
    status === 'confirmed' && (item.voice_id
      ? `[Join voice channel](${channelLink(item.guild_id, item.voice_id)})`
      : `**Meet in** <#${item.channel_id}>`),
    status === 'confirmed' && eventId && `[Open Discord Event](https://discord.com/events/${item.guild_id}/${eventId})`,
    status === 'confirmed' && `**RSVPs** ${rsvps.going}${item.capacity ? `/${item.capacity}` : ''} going • ${rsvps.maybe} maybe • ${rsvps.declined} can’t attend`,
    status === 'confirmed' && waiting > 0 && `**Waitlist** ${waiting} waiting or offered`,
    status === 'confirmed' && rsvps.reconfirm > 0 && `**RSVP again** ${rsvps.reconfirm} pending after reschedule`,
    status === 'confirmed' && going.length > 0 &&
      `**Going** ${going.map(id => `<@${id}>`).join(', ')}${rsvps.going > going.length ? ` +${rsvps.going - going.length} more` : ''}`,
    status !== 'cancelled' && games.some(game => game.rawg_id) && '[Game data by RAWG](https://rawg.io/)',
  ].filter(line => typeof line === 'string' && line)
  const prefix = delivery?.kind === 'rescheduled' ? 'Rescheduled · '
    : delivery?.kind === 'reminder' ? 'Coming up · ' : status === 'confirmed' ? 'Confirmed · ' : ''
  return {
    embeds: [{
      title: prefix + escapeText(item.title),
      description: highlights.join('\n').slice(0, 4096),
      color: status === 'cancelled' ? 0xaa4466 : 0x35d99b,
      thumbnail: featuredGame?.image && status !== 'cancelled' ? { url: featuredGame.image } : undefined,
      footer: delivery ? { text: `Play Villa · ${delivery.id}` } : undefined,
    }],
    components: controls(item, at, delivery),
  }
}

export function spotOffer(item: Session, delivery: Delivery, offer: { user_id: string; offered_until: number }): Message {
  return {
    content: `<@${offer.user_id}>`,
    embeds: [{
      title: 'A game night spot opened',
      description: `A seat for **${escapeText(item.title)}** is held for you until ${timestamp(offer.offered_until, 'R')}. Select Going to accept it.`,
      footer: { text: `Play Villa · ${delivery.id}` },
    }],
    components: [row(button(key('going', item), 'Going', 3), button(key('show', item), 'View details'))],
  }
}

// A nudge, not a board: it keeps no tally, so the live board stays the one to watch.
export function lastCall(item: Session, delivery: Delivery, mention: string): Message {
  return {
    content: mention,
    embeds: [{
      title: `Last call · ${escapeText(item.title)}`,
      description: `Voting closes ${timestamp(item.deadline, 'R')}. Pick a game and the times you can make so the plan includes you.`,
      color: 0x35d99b,
      footer: { text: `Play Villa · ${delivery.id}` },
    }],
    components: [row(button(key('ballot', item), 'Vote & pick times', 1))],
  }
}
