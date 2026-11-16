import { channelLink, escapeText, timestamp, type Message } from './discord-api.ts'
import { recommend, type Details } from './store.ts'
import type { Delivery, Session } from './types.ts'

const button = (custom_id: string, label: string, style = 2) => ({ type: 2, style, custom_id, label })
const row = (...components: Record<string, unknown>[]) => ({ type: 1, components })
const key = (action: string, id: string) => `gn:${action}:${id}`
const label = (slice: string, max = 100) => slice.length > max ? `${slice.slice(0, max - 1)}…` : slice

function controls(item: Session, at: number) {
  const { id, status, deadline } = item
  const details = button(key('show', id), 'View details')
  if (status === 'cancelled') return [row(details)]
  const buttons = [
    button(key('going', id), 'Going', 3),
    button(key('maybe', id), 'Maybe'),
    button(key('declined', id), 'Can’t attend', 4),
  ]
  return status === 'open' && deadline > at
    ? [row(button(key('vote-menu', id), 'Vote', 1), button(key('time-menu', id), 'Available times', 1), details), row(...buttons)]
    : [row(details, ...buttons)]
}

export function voteMenu(data: Details, current: number | null): Message {
  if (!data.games.length) return { content: 'Use `/gamenight nominate` to add the first game.' }
  return {
    content: 'Choose a game or retract your vote.',
    components: [row({
      type: 3, custom_id: key('vote', data.item.id),
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
  const options = data.slots.map(slot => ({
    label: local.format(slot.starts_at * 1000),
    value: String(slot.starts_at),
    default: current.includes(slot.starts_at),
  }))
  if (!options.length) return { content: 'There are no proposed times yet.' }
  return {
    content: `Select all times you can make. The times below use the session’s time zone.\n${data.slots.map(slot => timestamp(slot.starts_at)).join(' • ')}`,
    components: [
      row({ type: 3, custom_id: key('times', data.item.id), min_values: 1, max_values: options.length, options }),
      row(button(key('clear-times', data.item.id), 'Clear availability')),
    ],
  }
}

export function board(data: Details, at: number, delivery?: Delivery): Message {
  const { item, games, slots, going, rsvps } = data
  const selected = games.find(game => game.id === item.game_id)
  const status = item.status === 'open' && at >= item.deadline ? 'closed' : item.status
  const proposal = recommend(data, at)
  const suggestedGame = item.status === 'open' ? proposal.game : selected
  const suggestedTime = item.status === 'open' ? proposal.slot?.starts_at : item.starts_at
  const highlights = [
    item.description && escapeText(item.description),
    status === 'open' && `**Voting closes** ${timestamp(item.deadline, 'R')}`,
    status === 'closed' && 'Voting is closed. An organizer can confirm the session.',
    status === 'cancelled' && 'This game night was cancelled.',
    status === 'confirmed' && item.starts_at && selected &&
      `**${escapeText(selected.name)}** • ${timestamp(item.starts_at, 'F')}`,
    ['open', 'closed'].includes(status) && `**Recommended game** ${suggestedGame ? escapeText(suggestedGame.name) : 'Awaiting votes'}`,
    ['open', 'closed'].includes(status) && `**Recommended time** ${suggestedTime ? timestamp(suggestedTime) : 'Awaiting availability'}`,
    status === 'confirmed' && (item.voice_id
      ? `[Join voice channel](${channelLink(item.guild_id, item.voice_id)})`
      : `**Meet in** <#${item.channel_id}>`),
    status !== 'cancelled' && `**RSVPs** ${rsvps.going}${item.capacity ? `/${item.capacity}` : ''} going • ${rsvps.maybe} maybe • ${rsvps.declined} can’t attend`,
    status === 'confirmed' && going.length > 0 &&
      `**Going** ${going.map(id => `<@${id}>`).join(', ')}${rsvps.going > going.length ? ` +${rsvps.going - going.length} more` : ''}`,
    status !== 'cancelled' && games.some(game => game.rawg_id) && '[Game data by RAWG](https://rawg.io/)',
  ].filter(Boolean)
  const listings = [
    ...games.slice(0, 8).map(game => `#${game.id} ${escapeText(game.name)} · ${game.votes} vote(s)`),
    games.length > 8 && `${games.length - 8} more games in the vote menu or companion site.`,
    ...slots.map(slot => `${timestamp(slot.starts_at)} · ${slot.available} available`),
  ].filter(Boolean)
  // Channel boards are snapshots. The details button always reads current totals.
  if (!delivery && listings.length) highlights.push('', listings.join('\n').slice(0, 1900))
  if (!delivery) highlights.push(`\nSession ID: \`${item.id}\``)
  const prefix = delivery?.kind === 'reminder' ? 'Coming up · ' : status === 'confirmed' ? 'Confirmed · ' : ''
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
