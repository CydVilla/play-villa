import { escapeText, timestamp, type Message } from './discord-api.ts'
import { board, timeMenu, voteMenu } from './presentation.ts'
import { allowRawg, rawgGame, searchRawg } from './rawg.ts'
import {
  acceptsBallots, addSlot, attendance, availability, checkedLabel, close, confirm, details, guild, manualSession,
  mutate, nomination, rows, session, statement, vote,
} from './store.ts'
import { canonicalZone, parseFuture, parseWeekly, weeklyWindow } from './time.ts'
import { InputError, snowflake, type Env, type Guild, type RSVP, type Session, type Weekly } from './types.ts'

interface Option {
  name: string
  value?: string | boolean | number
  focused?: boolean
  options?: Option[]
}

export interface Interaction {
  type: number
  id: string
  application_id: string
  guild_id?: string
  channel_id?: string
  channel?: { id: string }
  token: string
  member?: { user?: { id: string; bot?: boolean }; permissions?: string; roles?: string[] }
  data?: { name?: string; options?: Option[]; custom_id?: string; values?: string[] }
}

type Context = {
  env: Env
  db: D1Database
  interaction: Interaction
  guildId: string
  channelId: string
  user: string
  admin: boolean
  now: number
}

type ActionResult = { message: Message; notify?: string }
const reply = (content: string, notify?: string): ActionResult => ({ message: { content }, notify })

function scope(env: Env, interaction: Interaction, now: number): Context {
  const guildId = interaction.guild_id
  const channelId = interaction.channel_id ?? interaction.channel?.id
  const user = interaction.member?.user?.id
  if (!snowflake(guildId) || !snowflake(channelId) || !snowflake(user) || interaction.member?.user?.bot) {
    throw new InputError('Use /gamenight from a Discord server channel.')
  }
  if (env.DISCORD_GUILD_ID && env.DISCORD_GUILD_ID !== guildId) {
    throw new InputError('This Play Villa installation serves a different Discord server.')
  }
  const permissionBits = interaction.member?.permissions ?? ''
  const admin = /^\d{1,24}$/.test(permissionBits) && Boolean(BigInt(permissionBits) & (32n | 8n))
  return { env, db: env.DB, interaction, guildId, channelId, user, admin, now }
}

function options(interaction: Interaction) {
  const group = interaction.data?.options?.[0]
  const values = new Map((group?.options ?? []).map(option => [option.name, option.value]))
  return {
    action: group?.name ?? '',
    values,
    text: (key: string) => {
      const value = values.get(key)
      return typeof value === 'string' ? value.trim() : ''
    },
    number: (key: string, min: number, max: number) => {
      const value = values.get(key)
      if (value === undefined) return null
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new InputError(`Choose a value from ${min} to ${max} for ${key}.`)
      }
      return value
    },
  }
}

type Options = ReturnType<typeof options>

function fromRole(ctx: Context, settings: Guild) {
  return settings.organizer_role !== null && Boolean(ctx.interaction.member?.roles?.includes(settings.organizer_role))
}

function mayManage(ctx: Context, settings: Guild, item: Session) {
  return ctx.admin || item.organizer_id === ctx.user || fromRole(ctx, settings)
}

async function settingsFor(ctx: Context) {
  const settings = await guild(ctx.db, ctx.guildId)
  if (!settings) throw new InputError('Ask a server manager to run /gamenight configure with an announcement channel.')
  return settings
}

async function scopedSession(ctx: Context, id: string) {
  const item = await session(ctx.db, ctx.guildId, id)
  if (!item || item.channel_id !== ctx.channelId) throw new InputError('Choose a game night from this channel.')
  return item
}

function requiredChannel(ctx: Context, settings: Guild) {
  if (ctx.channelId !== settings.channel_id) throw new InputError(`Use this command in <#${settings.channel_id}>.`)
}

function votingOpen(item: Session, at: number) {
  if (item.status !== 'open' || item.deadline <= at) throw new InputError('Voting has closed for this game night.')
}

function nextOpening(settings: { timezone: string }, weekly: Weekly, at: number) {
  const window = weeklyWindow(at, settings.timezone, weekly)
  if (window.close > at && window.slots.length) return window.open
  return weeklyWindow(at, settings.timezone, weekly, true).open
}

async function configure(ctx: Context, opts: Options) {
  if (!ctx.admin) throw new InputError('You need Manage Server to configure Play Villa.')
  const previous = await guild(ctx.db, ctx.guildId)
  const channel = opts.text('channel') || previous?.channel_id
  const voice = opts.values.get('clear_voice') === true ? null : opts.text('voice') || previous?.voice_id || null
  const role = opts.values.get('clear_role') === true ? null : opts.text('organizer_role') || previous?.organizer_role || null
  if (!snowflake(channel) || (voice && !snowflake(voice)) || (role && !snowflake(role))) {
    throw new InputError('Choose an announcement channel and valid optional channels or role.')
  }
  if (role === ctx.guildId) throw new InputError('Choose a dedicated organizer role or use Manage Server.')
  const timezone = opts.text('timezone') ? canonicalZone(opts.text('timezone')) : previous?.timezone || 'UTC'
  const minimum = opts.number('minimum', 1, 25) ?? previous?.minimum ?? 2
  const reminder = opts.number('reminder', 0, 10080) ?? previous?.reminder ?? 60
  const duration = opts.number('duration', 15, 480) ?? previous?.duration ?? 120
  const next = previous?.weekly ? nextOpening({ timezone }, JSON.parse(previous.weekly), ctx.now) : null
  const changed = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
    statement(ctx.db, `
      INSERT INTO guilds (id, channel_id, timezone, voice_id, organizer_role, minimum, reminder, duration)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gate}
      ON CONFLICT(id) DO UPDATE SET
        channel_id = excluded.channel_id, timezone = excluded.timezone, voice_id = excluded.voice_id,
        organizer_role = excluded.organizer_role, minimum = excluded.minimum, reminder = excluded.reminder,
        duration = excluded.duration,
        next_open_at = CASE WHEN guilds.timezone <> excluded.timezone THEN ? ELSE guilds.next_open_at END,
        weekly_version = CASE WHEN guilds.timezone <> excluded.timezone AND guilds.weekly IS NOT NULL
          THEN ? ELSE guilds.weekly_version END
      WHERE guilds.weekly_version IS ? AND guilds.timezone IS ?
    `, ctx.guildId, channel, timezone, voice, role, minimum, reminder, duration, next,
    ctx.interaction.id, previous?.weekly_version ?? null, previous?.timezone ?? null),
  ])
  return reply(changed?.[0] ? `New sessions will use <#${channel}> and ${timezone}.` : 'Settings may have changed. Run the command again to verify.')
}

async function weekly(ctx: Context, settings: Guild, opts: Options) {
  if (!ctx.admin) throw new InputError('You need Manage Server to change weekly scheduling.')
  if (opts.values.size === 0) {
    return reply(settings.weekly && settings.next_open_at !== null
      ? `Weekly rounds are enabled in ${settings.timezone}. Next planning window starts ${timestamp(settings.next_open_at)}.`
      : 'Weekly rounds are disabled.')
  }
  const prior = settings.weekly ? JSON.parse(settings.weekly) as Weekly : null
  const specified = ['open', 'close', 'slots'].some(key => opts.values.has(key))
  const auto = opts.values.get('auto')
  const capacity = opts.number('capacity', 0, 99)
  const autoConfirm = typeof auto === 'boolean' ? auto : prior?.auto ?? false
  const max = capacity === null ? prior?.capacity ?? null : capacity || null
  const rule = opts.values.get('enabled') === false ? null : specified
    ? parseWeekly(opts.text('open'), opts.text('close'), opts.text('slots'), autoConfirm, max)
    : prior && { ...prior, auto: autoConfirm, capacity: max }
  if (!rule && opts.values.get('enabled') !== false) {
    throw new InputError('To enable weekly planning, supply open, close and slots.')
  }
  if (rule?.auto && rule.capacity !== null && rule.capacity < settings.minimum) {
    throw new InputError('Choose a capacity at least as large as the automatic confirmation minimum.')
  }
  const next = rule ? nextOpening(settings, rule, ctx.now) : null
  const changed = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
    statement(ctx.db, `
      UPDATE guilds SET weekly = ?, weekly_version = ?, next_open_at = ?
      WHERE id = ? AND timezone = ? AND weekly_version IS ? AND ${gate}
    `, rule ? JSON.stringify(rule) : null, ctx.interaction.id, next, ctx.guildId, settings.timezone, settings.weekly_version),
  ])
  if (!changed?.[0]) return reply('Settings may have changed. Run /gamenight weekly again to verify.')
  return reply(rule && next !== null
    ? `Weekly rounds are enabled in ${settings.timezone}. The scheduler will check the window opening ${timestamp(next)}.`
    : 'Weekly rounds are disabled. Any existing rounds keep their current deadlines.')
}

async function create(ctx: Context, settings: Guild, opts: Options) {
  requiredChannel(ctx, settings)
  if (!ctx.admin && !fromRole(ctx, settings)) throw new InputError('Creating game nights requires Manage Server or the organizer role.')
  const game = checkedLabel(opts.text('game'), 100)
  const description = opts.text('description') ? checkedLabel(opts.text('description'), 400) : ''
  const proposed = [opts.text('time'), ...opts.text('alternatives').split(',').filter(value => value.trim())]
  const slots = [...new Set(proposed.map(time => parseFuture(time, settings.timezone, ctx.now)))].sort((a, b) => a - b)
  if (slots.length > 10) throw new InputError('Choose at most ten time slots.')
  const deadline = opts.text('deadline') ? parseFuture(opts.text('deadline'), settings.timezone, ctx.now)
    : Math.min(slots[0] - 60, ctx.now + 3 * 86400)
  if (deadline <= ctx.now || deadline >= slots[0]) throw new InputError('Set a future voting deadline before the first slot.')
  const id = ctx.interaction.id
  const capacity = opts.number('capacity', 1, 99)
  const result = await mutate(ctx.db, id, ctx.now, gate =>
    manualSession(ctx.db, settings, id, ctx.user, game, description, slots, deadline, capacity, ctx.now, gate))
  return reply(result ? `Game night created. Voting closes ${timestamp(deadline)}. The channel announcement is queued.`
    : 'This request was already handled.', id)
}

async function edit(ctx: Context, item: Session, opts: Options) {
  const title = opts.text('title') ? checkedLabel(opts.text('title'), 100) : null
  const description = opts.values.get('clear_description') === true ? ''
    : opts.text('description') ? checkedLabel(opts.text('description'), 400) : null
  const deadline = opts.text('deadline') ? parseFuture(opts.text('deadline'), item.timezone, ctx.now) : null
  const capacity = opts.number('capacity', 0, 99)
  const voice = opts.text('voice') || null
  const clearVoice = opts.values.get('clear_voice') === true
  if (voice && !snowflake(voice)) throw new InputError('Choose a valid voice channel.')
  if (title === null && description === null && deadline === null && capacity === null && !voice && !clearVoice) {
    throw new InputError('Provide at least one change to the game night.')
  }
  const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
    statement(ctx.db, `
      UPDATE sessions SET title = coalesce(?, title), description = coalesce(?, description),
        deadline = coalesce(?, deadline), capacity = CASE WHEN ? IS NULL THEN capacity ELSE nullif(?, 0) END,
        voice_id = CASE WHEN ? THEN NULL ELSE coalesce(?, voice_id) END
      WHERE id = ? AND status <> 'cancelled' AND ${gate}
      AND (? IS NULL OR (${acceptsBallots} AND ? < (SELECT min(starts_at) FROM slots WHERE session_id = sessions.id)))
      AND (? IS NULL OR ? = 0 OR ? >= (
        SELECT count(*) FROM rsvps WHERE session_id = sessions.id AND response = 'going'
      ))
    `, title, description, deadline, capacity, capacity, Number(clearVoice), voice, item.id,
    deadline, ctx.now, deadline, capacity, capacity, capacity),
  ])
  return reply(result?.[0] ? 'Game night updated. View details shows the latest settings.'
    : 'The update did not apply. Check the voting deadline, cancellation status, and current Going count.')
}

function positive(value: string) {
  if (!/^\d{1,15}$/.test(value) || Number(value) < 1) throw new InputError('Choose a valid entry from the list.')
  return Number(value)
}

async function slash(ctx: Context): Promise<ActionResult> {
  if (ctx.interaction.data?.name !== 'gamenight') throw new InputError('Unrecognized command.')
  const opts = options(ctx.interaction)
  if (opts.action === 'configure') return configure(ctx, opts)
  const settings = await settingsFor(ctx)
  if (opts.action === 'weekly') return weekly(ctx, settings, opts)
  if (opts.action === 'create') return create(ctx, settings, opts)
  if (opts.action === 'search') {
    requiredChannel(ctx, settings)
    const query = checkedLabel(opts.text('query'), 80)
    await allowRawg(ctx.env, ctx.guildId, ctx.now)
    const results = await searchRawg(ctx.env, query)
    return reply(results.length ? `${results.map(game => `**${escapeText(game.name)}** · ID \`${game.id}\``).join('\n')}\nUse the ID with \`/gamenight nominate\`. [Game data by RAWG](https://rawg.io/)`
      : 'No RAWG results found. Use /gamenight nominate with a custom game name.')
  }
  const item = await scopedSession(ctx, opts.text('session'))
  if (opts.action === 'show') return { message: board(await details(ctx.db, item), ctx.now) }
  if (opts.action === 'nominate') {
    votingOpen(item, ctx.now)
    const name = opts.text('game')
    const rawgId = opts.number('rawg_id', 1, 2147483647)
    if (Boolean(rawgId) === Boolean(name)) throw new InputError('Provide either a custom game name or a RAWG game ID.')
    if (rawgId) await allowRawg(ctx.env, ctx.guildId, ctx.now)
    const game = rawgId ? await rawgGame(ctx.env, rawgId) : null
    const gameName = game?.name ?? checkedLabel(name, 100)
    const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
      nomination(ctx.db, item.id, gameName, ctx.now, gate, game?.id, game?.image),
    ])
    return reply(result?.[0] ? `Added **${escapeText(gameName)}** to the ballot.` : 'The game is already listed, the ballot is full, or voting has closed.')
  }
  if (opts.action === 'propose-time') {
    votingOpen(item, ctx.now)
    const starts = parseFuture(opts.text('time'), item.timezone, ctx.now)
    if (starts <= item.deadline) throw new InputError('The proposed time must be after the voting deadline.')
    const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [addSlot(ctx.db, item.id, starts, gate, ctx.now)])
    return reply(result?.[0] ? `Added ${timestamp(starts)} to the availability poll.` : 'This time already exists, the poll is full, or voting has closed.')
  }
  if (!mayManage(ctx, settings, item)) throw new InputError('Only an organizer or server manager can manage this game night.')
  switch (opts.action) {
    case 'edit': return edit(ctx, item, opts)
    case 'close': {
      const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [close(ctx.db, item.id, ctx.now, gate, false)])
      return reply(result?.[0] ? 'Voting closed. The results announcement is queued.' : 'This game night is no longer open.', item.id)
    }
    case 'confirm': {
      const game = opts.text('game') ? positive(opts.text('game')) : null
      const time = opts.text('time') ? positive(opts.text('time')) : null
      const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [confirm(ctx.db, item.id, game, time, ctx.now, gate)])
      return reply(result?.[0] ? 'Game night confirmed. The announcement is queued.'
        : 'A future date and nominated game are required. Choose explicit overrides if recommendations are missing or expired.', item.id)
    }
    case 'cancel': {
      const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
        statement(ctx.db, `
          UPDATE sessions SET status = 'cancelled', decided_at = ? WHERE id = ? AND status <> 'cancelled'
          AND CASE WHEN status = 'confirmed' THEN starts_at + duration * 60
            ELSE (SELECT max(starts_at) FROM slots WHERE session_id = sessions.id) END > ?
          AND ${gate}
        `, ctx.now, item.id, ctx.now),
      ])
      return reply(result?.[0] ? 'Game night cancelled. The announcement is queued.' : 'This game night already ended or was cancelled.', item.id)
    }
    case 'delivery-status': {
      const deliveries = await rows<{ kind: string; state: string; error: string | null }>(ctx.db,
        'SELECT kind, state, error FROM deliveries WHERE session_id = ? ORDER BY id', item.id)
      return reply(deliveries.map(job => `**${job.kind}** · ${job.state}${job.error ? ` · ${job.error}` : ''}`).join('\n'))
    }
    default: throw new InputError('Unrecognized game night command.')
  }
}

async function component(ctx: Context): Promise<ActionResult> {
  const match = /^gn:([a-z-]+):([a-f0-9-]{17,36})$/.exec(ctx.interaction.data?.custom_id ?? '')
  if (!match) throw new InputError('Unknown game night control.')
  const [, action, id] = match
  const item = await scopedSession(ctx, id)
  const values = ctx.interaction.data?.values ?? []
  if (action === 'show') return { message: board(await details(ctx.db, item), ctx.now) }
  if (action === 'going' || action === 'maybe' || action === 'declined') {
    const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [
      attendance(ctx.db, id, ctx.user, action as RSVP, ctx.now, gate),
    ])
    const states = { going: 'Going', maybe: 'Maybe', declined: 'Can’t attend' }
    return reply(result?.[0] ? `RSVP saved as **${states[action]}**.`
      : 'The game night is full or no longer accepting RSVPs. Use View details to see its status.')
  }
  votingOpen(item, ctx.now)
  if (action === 'vote-menu') {
    const existing = await statement(ctx.db, 'SELECT game_id FROM votes WHERE session_id = ? AND user_id = ?', id, ctx.user)
      .first<number>('game_id')
    return { message: voteMenu(await details(ctx.db, item), existing) }
  }
  if (action === 'time-menu') {
    const selected = await rows<{ starts_at: number }>(ctx.db,
      'SELECT starts_at FROM availability WHERE session_id = ? AND user_id = ?', id, ctx.user)
    return { message: timeMenu(await details(ctx.db, item), selected.map(row => row.starts_at)) }
  }
  if (action === 'vote' && values.length === 1) {
    const game = values[0] === 'none' ? null : positive(values[0])
    const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => [vote(ctx.db, id, ctx.user, game, ctx.now, gate)])
    return reply(result ? game === null ? 'Your vote has been cleared.' : result[0] ? 'Vote saved.' : 'The ballot has changed or closed.'
      : 'This request was already handled.')
  }
  if (action === 'times' || action === 'clear-times') {
    if (values.length > 10 || (action === 'times' && !values.length)) throw new InputError('Choose up to ten available times.')
    const selected = action === 'clear-times' ? [] : [...new Set(values.map(positive))]
    const result = await mutate(ctx.db, ctx.interaction.id, ctx.now, gate => availability(ctx.db, id, ctx.user, selected, ctx.now, gate))
    return reply(result && (!selected.length || result[1] === selected.length) ? 'Availability saved.' : 'The time list has changed or voting is closed.')
  }
  throw new InputError('Unknown game night control.')
}

export async function handleInteraction(env: Env, interaction: Interaction, now: number): Promise<ActionResult> {
  try {
    const ctx = scope(env, interaction, now)
    return interaction.type === 2 ? await slash(ctx) : await component(ctx)
  } catch (error) {
    if (error instanceof InputError) return reply(error.message)
    console.error('Game night interaction failed', interaction.id)
    return reply('Play Villa could not complete that request. Try again or check View details.')
  }
}

export async function autocomplete(env: Env, interaction: Interaction, now: number) {
  const ctx = scope(env, interaction, now)
  const command = interaction.data?.options?.[0]
  const focus = command?.options?.find(option => option.focused)
  if (!focus || typeof focus.value !== 'string') return []
  const query = focus.value.trim().toLowerCase()
  const filter = (name: string, value: string) => name.toLowerCase().includes(query) || value.startsWith(query)
  if (focus.name === 'session') {
    return rows<{ name: string; value: string }>(ctx.db, `
      SELECT substr(title, 1, 74) || ' · ' || status AS name, id AS value
      FROM sessions WHERE guild_id = ? AND channel_id = ?
      AND (instr(lower(title), ?) OR instr(id, ?) OR ? = '')
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 WHEN 'confirmed' THEN 2 ELSE 3 END,
        created_at DESC LIMIT 25
    `, ctx.guildId, ctx.channelId, query, query, query)
  }
  const item = await scopedSession(ctx, options(interaction).text('session'))
  if (focus.name === 'game') {
    const games = await rows<{ name: string; id: number; votes: number }>(ctx.db,
      'SELECT name, id, votes FROM game_tally WHERE session_id = ? ORDER BY votes DESC, id', item.id)
    return games.map(game => ({ name: `${game.name.slice(0, 80)} · ${game.votes} votes`, value: String(game.id) }))
      .filter(choice => filter(choice.name, choice.value))
  }
  if (focus.name === 'time') {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: item.timezone, weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
    const slots = await rows<{ starts_at: number; available: number }>(ctx.db,
      'SELECT starts_at, available FROM slot_tally WHERE session_id = ? AND starts_at > ? ORDER BY starts_at', item.id, now)
    return slots.map(slot => ({
      name: `${format.format(slot.starts_at * 1000)} · ${slot.available} available`, value: String(slot.starts_at),
    })).filter(choice => filter(choice.name, choice.value))
  }
  return []
}
