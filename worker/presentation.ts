import { channelLink, escapeText, timestamp, type Message } from './discord-api.ts'
import { partyLabel } from './party.ts'
import { recommend, type Details } from './store.ts'
import type { CreateDraft, Delivery, GameDetails, Session } from './types.ts'

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

function controls(item: Session, at: number) {
  const { status, deadline } = item
  const details = button(key('show', item), 'View details')
  if (status === 'cancelled') return [row(details)]
  const buttons = [
    button(key('going', item), 'Going', 3),
    button(key('maybe', item), 'Maybe'),
    button(key('declined', item), 'Can’t attend', 4),
  ]
  return status === 'open' && deadline > at
    ? [row(button(key('vote-menu', item), 'Vote', 1), button(key('time-menu', item), 'Available times', 1), button(key('surprise', item), '🎲 Surprise me'), details), row(...buttons)]
    : [row(details, ...buttons)]
}

export function voteMenu(data: Details, current: number | null): Message {
  if (!data.games.length) return { content: 'Use `/gamenight nominate` to add the first game.' }
  return {
    content: 'Choose a game or retract your vote.',
    components: [row({
      type: 3, custom_id: key('vote', data.item),
      options: [
        ...data.games.map(game => ({ label: label(game.name), value: String(game.id), default: current === game.id })),
        { label: 'Retract my vote', value: 'none' },
      ],
    })],
  }
}

export function timeMenu(data: Details, current: number[]): Message {
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: data.item.timezone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
  const options = data.slots.map((slot, index) => ({
    label: `${index + 1}. ${local.format(slot.starts_at * 1000)}`,
    value: String(slot.starts_at),
    default: current.includes(slot.starts_at),
  }))
  if (!options.length) return { content: 'There are no proposed times yet.' }
  return {
    content: `Select every time you can make. The list here uses your local time. Match the numbers in the dropdown, which uses ${data.item.timezone}.\n${data.slots.map((slot, index) => `${index + 1}. ${timestamp(slot.starts_at, 'F')}`).join('\n')}`,
    components: [
      row({ type: 3, custom_id: key('times', data.item), min_values: 1, max_values: options.length, options }),
      row(button(key('clear-times', data.item), 'Clear availability')),
    ],
  }
}

export function board(data: Details, at: number, delivery?: Delivery): Message {
  const { item, games, slots, going, rsvps, waiting, eventId } = data
  const selected = games.find(game => game.id === item.game_id)
  const status = item.status === 'open' && at >= item.deadline ? 'closed' : item.status
  const isBallot = status === 'open' || status === 'closed'
  const proposal = recommend(data, at)
  const suggestedGame = item.status === 'open' ? proposal.game : selected
  const suggestedTime = item.status === 'open' ? proposal.slot?.starts_at : item.starts_at
  const featuredGame = isBallot ? suggestedGame ?? games[0] : status === 'confirmed' ? selected : undefined
  const gameDetails = featuredGame && gameDetailsText(JSON.parse(featuredGame.game_details) as GameDetails)
  const highlights = [
    item.description && escapeText(item.description),
    status === 'open' && `**Voting closes** ${timestamp(item.deadline, 'R')}`,
    status === 'closed' && 'Voting is closed. An organizer can confirm the session.',
    status === 'cancelled' && 'This game night was cancelled.',
    delivery?.kind === 'rescheduled' && 'The start time changed. Please RSVP again on this board.',
    status === 'confirmed' && item.starts_at && selected &&
      `**${escapeText(selected.name)}** • ${timestamp(item.starts_at, 'F')}`,
    isBallot && `**Recommended game** ${suggestedGame ? escapeText(suggestedGame.name) : 'Awaiting votes'}`,
    isBallot && `**Recommended time** ${suggestedTime ? timestamp(suggestedTime) : 'Awaiting availability'}`,
    isBallot && featuredGame && gameDetails && `\n**About ${escapeText(featuredGame.name)}**`,
    gameDetails,
    status === 'confirmed' && (item.voice_id
      ? `[Join voice channel](${channelLink(item.guild_id, item.voice_id)})`
      : `**Meet in** <#${item.channel_id}>`),
    status === 'confirmed' && eventId && `[Open Discord Event](https://discord.com/events/${item.guild_id}/${eventId})`,
    status !== 'cancelled' && `**RSVPs** ${rsvps.going}${item.capacity ? `/${item.capacity}` : ''} going • ${rsvps.maybe} maybe • ${rsvps.declined} can’t attend`,
    status === 'confirmed' && waiting > 0 && `**Waitlist** ${waiting} waiting or offered`,
    status === 'confirmed' && rsvps.reconfirm > 0 && `**RSVP again** ${rsvps.reconfirm} pending after reschedule`,
    status === 'confirmed' && going.length > 0 &&
      `**Going** ${going.map(id => `<@${id}>`).join(', ')}${rsvps.going > going.length ? ` +${rsvps.going - going.length} more` : ''}`,
    status !== 'cancelled' && games.some(game => game.rawg_id) && '[Game data by RAWG](https://rawg.io/)',
  ].filter(Boolean)
  const listings = [
    ...games.slice(0, 8).map(game => {
      const tags = partyLabel(game)
      return `#${game.id} ${escapeText(game.name)} · ${game.votes} vote(s)${tags ? ` · ${tags}` : ''}`
    }),
    games.length > 8 && `${games.length - 8} more games in the vote menu or companion site.`,
    ...slots.map(slot => `${timestamp(slot.starts_at)} · ${slot.available} available`),
  ].filter(Boolean)
  const sessionId = delivery ? '' : `\nSession ID: \`${item.id}\``
  const remaining = Math.min(1900, 4096 - highlights.join('\n').length - sessionId.length - 3)
  if (listings.length && remaining > 0) highlights.push('', listings.join('\n').slice(0, remaining))
  if (sessionId) highlights.push(sessionId)
  const prefix = delivery?.kind === 'rescheduled' ? 'Rescheduled · '
    : delivery?.kind === 'reminder' ? 'Coming up · ' : status === 'confirmed' ? 'Confirmed · ' : ''
  return {
    embeds: [{
      title: prefix + escapeText(item.title),
      description: highlights.join('\n'),
      color: status === 'cancelled' ? 0xaa4466 : 0x35d99b,
      footer: delivery ? { text: `Play Villa · ${delivery.id}` } : undefined,
    }],
    components: controls(item, at),
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
