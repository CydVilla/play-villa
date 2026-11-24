import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.ts'
import { refreshBoards } from '../worker/board-refresh.ts'
import { syncEvents } from '../worker/events.ts'
import { deliverPending } from '../worker/delivery.ts'
import { autocomplete, handleInteraction, updatesMessage, type Interaction } from '../worker/interactions.ts'
import { board } from '../worker/presentation.ts'
import { publicSchedule } from '../worker/public.ts'
import { scheduleRounds } from '../worker/schedule.ts'
import { details, recommend, session, statement } from '../worker/store.ts'
import { canonicalZone, parseTime, parseWeekly, weeklyWindow } from '../worker/time.ts'
import { nowSeconds, type Delivery, type Env, type Session } from '../worker/types.ts'
import { calendar } from '../src/calendar.js'
import { database } from './database.ts'

const app = '100000000000000000'
const server = '100000000000000001'
const otherServer = '100000000000000002'
const channel = '100000000000000003'
const otherChannel = '100000000000000004'
const organizer = '100000000000000005'
const member = '100000000000000006'
const otherMember = '100000000000000007'
const role = '100000000000000008'
const at = parseTime('2026-11-16 20:00Z', 'UTC')
const time1 = parseTime('2026-11-20 20:00Z', 'UTC')
const time2 = parseTime('2026-11-21 21:00Z', 'UTC')

function harness(config: Omit<Env, 'DB'> = {}) {
  const db = database()
  const env = { ...config, DB: db as unknown as D1Database, DISCORD_APPLICATION_ID: app }
  let sequence = 0
  type ActionSettings = { user?: string; admin?: boolean; roles?: string[]; guild?: string; channel?: string; now?: number; id?: string }
  const action = async (name: string, fields: Record<string, string | number | boolean> = {},
    settings: ActionSettings = {},
    kind = 2, values?: string[]) => {
    const id = settings.id ?? String(200000000000000000n + BigInt(++sequence))
    const data = {
      name: 'gamenight',
      options: [{ name, options: Object.entries(fields).map(([name, value]) => ({ name, value })) }],
      ...(kind === 3 ? { custom_id: name, values } : {}),
    }
    const response = await handleInteraction(env, {
      type: kind, data, id, application_id: app, token: 'test-token', guild_id: settings.guild ?? server,
      channel_id: settings.channel ?? channel,
      member: { user: { id: settings.user ?? organizer }, permissions: settings.admin !== false ? '32' : '0', roles: settings.roles },
    }, settings.now ?? at)
    return { id, ...response }
  }
  const one = (sql: string, ...params: (string | number)[]) => db.sqlite.prepare(sql).get(...params)
  const configure = () => action('configure', { channel, timezone: 'UTC', organizer_role: role, reminder: 60 })
  const create = async (fields: Record<string, string | number | boolean> = {}, settings: ActionSettings & { preview?: boolean } = {}) => {
    const { preview, ...actionSettings } = settings
    const created = await action('create', {
      game: 'Overcooked', time: '2026-11-20 20:00Z', alternatives: '2026-11-21 21:00Z', ...fields,
    }, actionSettings)
    if (preview || !created.message.components?.length) return created
    const published = await click('publish-typed', created.id, actionSettings.user ?? organizer, undefined, {
      user: actionSettings.user, admin: actionSettings.admin, roles: actionSettings.roles,
      guild: actionSettings.guild, channel: actionSettings.channel, now: actionSettings.now,
    })
    return { ...published, id: created.id }
  }
  const click = (name: string, id: string, user: string, values?: string[], settings = {}) =>
    action(`gn:${name}:${id}`, {}, { user, admin: false, ...settings }, 3, values)
  const get = (id: string) => session(env.DB, server, id)
  return { db, env, action, configure, create, click, one, get }
}

test('migration applies with foreign keys enforced and create is authorized, atomic and idempotent', async () => {
  const h = harness()
  assert.equal(h.one('PRAGMA foreign_keys')?.foreign_keys, 1)
  assert.match((await h.action('configure', { channel }, { admin: false })).message.content!, /Manage Server/)
  await h.configure()
  assert.match((await h.create({}, { user: member, admin: false })).message.content!, /organizer role/)
  const id = '200000000000000099'
  const results = await Promise.all([
    h.action('create', { game: 'Overcooked', time: '2026-11-20 20:00Z', alternatives: '2026-11-21 21:00Z' },
      { id, user: member, admin: false, roles: [role] }),
    h.action('create', { game: 'Overcooked', time: '2026-11-20 20:00Z', alternatives: '2026-11-21 21:00Z' },
      { id, user: member, admin: false, roles: [role] }),
  ])
  assert.equal(results.filter(result => result.message.components?.length).length, 2)
  assert.equal(h.one('SELECT count(*) AS n FROM create_drafts')?.n, 1)
  assert.match((await h.click('publish-typed', id, member, undefined, { admin: false, roles: [role] })).message.content!, /ready for voting/)
  assert.equal(h.one('SELECT count(*) AS n FROM sessions')?.n, 1)
  assert.equal(h.one('SELECT count(*) AS n FROM games')?.n, 1)
  assert.equal(h.one('SELECT count(*) AS n FROM slots')?.n, 2)
  assert.equal(h.one("SELECT count(*) AS n FROM deliveries WHERE kind = 'open'")?.n, 1)
  assert.throws(() => h.db.sqlite.prepare('INSERT INTO votes VALUES (?, ?, ?)').run(id, member, 123), /constraint/i)
})

test('nominations deduplicate normalized names and concurrent vote switches and retractions stay singular', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const owner = { user: member, admin: false }
  await h.action('nominate', { session: id, game: 'Deep Rock Galactic' }, owner)
  await h.action('nominate', { session: id, game: 'deep  rock galactic' }, owner)
  const ballot = await details(h.env.DB, (await h.get(id))!)
  assert.equal(ballot.games.length, 2)
  const [first, second] = ballot.games
  await Promise.all([
    h.click('vote', id, member, [String(first.id)]),
    h.click('vote', id, member, [String(second.id)]),
    h.click('vote', id, otherMember, [String(first.id)]),
  ])
  assert.equal(h.one('SELECT count(*) AS n FROM votes')?.n, 2)
  assert.equal(h.one('SELECT game_id FROM votes WHERE user_id = ?', member)?.game_id, second.id)
  await h.click('vote', id, member, ['none'])
  assert.equal(h.one('SELECT count(*) AS n FROM votes')?.n, 1)
  const menu = await h.click('vote-menu', id, otherMember)
  assert.match(JSON.stringify(menu.message), /Retract my vote/)
  await h.click('vote', id, member, [String(second.id)], { now: (await h.get(id))!.deadline })
  assert.equal(h.one('SELECT count(*) AS n FROM votes')?.n, 1)
})

test('shared vote totals refresh the public board after members vote', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  h.db.sqlite.prepare("UPDATE deliveries SET state = 'sent', message_id = '998000000000000001' WHERE session_id = ? AND kind = 'open'").run(id)
  await h.click('vote', id, member, ['1'])
  await h.click('vote', id, otherMember, ['1'])
  const patches: Record<string, unknown>[] = []
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /channels\/100000000000000003\/messages\/998000000000000001$/)
    assert.equal(options.method, 'PATCH')
    patches.push(JSON.parse(String(options.body)))
    return Response.json({})
  })
  await refreshBoards({ ...h.env, DISCORD_BOT_TOKEN: 'mock-token' }, at, id)
  assert.equal(fetch.mock.callCount(), 1)
  assert.match(JSON.stringify(patches[0]), /Overcooked\*\* · 2 votes/)
  assert.doesNotMatch(JSON.stringify(patches[0]), /Session ID/)
  assert.deepEqual(patches[0].allowed_mentions, { parse: [] })
  assert.equal(h.one('SELECT generation = synced AS current FROM board_updates WHERE session_id = ?', id)?.current, 1)
  assert.match(JSON.stringify((await h.click('show', id, member)).message), /Overcooked\*\* · 2 votes/)
})

test('board refresh waits for the post, catches votes made mid-edit, and only edits the newest board', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const env = { ...h.env, DISCORD_BOT_TOKEN: 'mock-token' }
  const job = () => h.one('SELECT generation > synced AS pending, next_at, error FROM board_updates WHERE session_id = ?', id)
  const bodies: string[] = []
  let respond = async () => Response.json({})
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /messages\/998000000000000001$/)
    bodies.push(String(options.body))
    return respond()
  })

  await h.click('vote', id, member, ['1'])
  await refreshBoards(env, at, id)
  assert.equal(fetch.mock.callCount(), 0)
  assert.deepEqual({ ...job() }, { pending: 1, next_at: at + 15, error: null })

  h.db.sqlite.prepare("UPDATE deliveries SET state = 'sent', message_id = '998000000000000001' WHERE session_id = ?").run(id)
  respond = async () => {
    respond = async () => Response.json({})
    await h.click('vote', id, otherMember, ['1'])
    return Response.json({})
  }
  await refreshBoards(env, at + 15, id)
  assert.equal(fetch.mock.callCount(), 2)
  assert.match(bodies[0], /Overcooked\*\* · 1 vote\\n/)
  assert.match(bodies[1], /Overcooked\*\* · 2 votes/)
  assert.equal(job()?.pending, 0)

  await h.click('vote', id, organizer, ['1'])
  respond = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } })
  await refreshBoards(env, at + 20, id)
  assert.deepEqual({ ...job() }, { pending: 1, next_at: at + 27, error: 'Discord rate limit.' })
  assert.match((await h.action('delivery-status', { session: id })).message.content!, /Board refresh\*\* · pending · Discord rate limit/)
  await refreshBoards(env, at + 26, id)
  assert.equal(fetch.mock.callCount(), 3)

  await h.action('close', { session: id })
  await h.click('maybe', id, member)
  assert.equal(job()?.pending, 1)
  await refreshBoards(env, at + 30, id)
  assert.equal(fetch.mock.callCount(), 3)
  assert.deepEqual({ ...job() }, { pending: 1, next_at: at + 45, error: null })
  h.db.sqlite.prepare("UPDATE deliveries SET state = 'blocked' WHERE session_id = ? AND kind = 'closed'").run(id)
  await refreshBoards(env, at + 45, id)
  assert.equal(fetch.mock.callCount(), 3)
  assert.deepEqual({ ...job() }, { pending: 0, next_at: 0, error: 'There is no posted board to refresh.' })
})

test('boards show live ballot controls and cover art, and RSVP buttons only once a night is confirmed', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const cover = 'https://media.rawg.io/media/games/cover.jpg'
  h.db.sqlite.prepare('UPDATE games SET image = ? WHERE session_id = ?').run(cover, id)
  const controls = (message: { components?: Record<string, unknown>[] }) =>
    (message.components ?? []).flatMap(row => (row.components as { custom_id: string }[]).map(item => item.custom_id))
  const open = (await h.action('show', { session: id })).message
  assert.deepEqual(controls(open), [`gn:ballot:${id}`, `gn:surprise:${id}`])
  assert.equal(open.embeds![0].thumbnail?.url, cover)
  assert.doesNotMatch(open.embeds![0].description!, /RSVPs/)
  await h.click('times', id, member, [String(time1)])
  await h.click('vote', id, member, ['1'])
  assert.match((await h.action('show', { session: id })).message.embeds![0].description!, /1 voted · 1 picked times/)
  await h.action('confirm', { session: id })
  const data = await details(h.env.DB, (await h.get(id))!)
  const confirmed = board(data, at)
  assert.deepEqual(controls(confirmed), ['going', 'maybe', 'declined'].map(action => `gn:${action}:${id}`))
  assert.doesNotMatch(confirmed.embeds![0].description!, /\*\*Games\*\*/)
  const reminder = board(data, at, { id: 9, kind: 'reminder' } as Delivery)
  assert.deepEqual(controls(reminder).at(-1), `gn:show:${id}`)
  const click = (custom_id: string) => ({ type: 3, data: { custom_id } }) as Interaction
  assert.equal(updatesMessage(click(`gn:vote:${id}`)), true)
  assert.equal(updatesMessage(click(`gn:times:${id}`)), true)
  assert.equal(updatesMessage(click(`gn:ballot:${id}`)), false)
  assert.equal(updatesMessage(click(`gn:going:${id}`)), false)
})

test('availability is replaceable, invalid slots preserve the ballot, and RSVP limits are atomic', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create({ capacity: 1 })
  const panel = await h.click('ballot', id, member)
  assert.match(JSON.stringify(panel.message), /"min_values":0,"max_values":2/)
  assert.match(panel.message.content!, new RegExp(`Not voted yet[\\s\\S]*None picked yet[\\s\\S]*1\\. <t:${time1}:F>[\\s\\S]*2\\. <t:${time2}:F>`))
  assert.match(JSON.stringify(panel.message.components), /"label":"1\. Fri/)
  assert.doesNotMatch(JSON.stringify(panel.message.components), /Retract my vote/)
  assert.deepEqual((await h.click('time-menu', id, member)).message, panel.message)
  const saved = await h.click('times', id, member, [String(time1), String(time2)])
  assert.match(saved.message.content!, /^✅ Saved 2 times\.\n\*\*Your vote\*\* Not voted yet\n\*\*Your times\*\* 2 of 2/)
  assert.match(saved.message.content!, /:F> · 1 available/)
  assert.equal(saved.notify, id)
  assert.equal(h.one('SELECT count(*) AS n FROM availability')?.n, 2)
  const voted = await h.click('vote', id, member, ['1'])
  assert.match(voted.message.content!, /^✅ Vote saved\.\n\*\*Your vote\*\* Overcooked/)
  assert.match(JSON.stringify(voted.message.components), /"default":true,"description":"1 vote"[\s\S]*Retract my vote/)
  assert.match((await h.click('times', id, member, [String(time2), '1234'])).message.content!, /time list changed/)
  assert.equal(h.one('SELECT count(*) AS n FROM availability')?.n, 2)
  await h.click('times', id, member, [String(time2)])
  assert.equal(h.one('SELECT starts_at FROM availability')?.starts_at, time2)
  await Promise.all([h.click('going', id, member), h.click('going', id, otherMember)])
  assert.equal(h.one("SELECT count(*) AS n FROM rsvps WHERE response = 'going'")?.n, 1)
  await h.click('maybe', id, member)
  await h.click('going', id, otherMember)
  assert.equal(h.one("SELECT user_id FROM rsvps WHERE response = 'going'")?.user_id, otherMember)
  await h.click('declined', id, member)
  assert.equal(h.one('SELECT available FROM slot_tally WHERE starts_at = ?', time2)?.available, 0)
  assert.match((await h.click('times', id, member, [])).message.content!, /^Your times were cleared\.\n/)
  assert.equal(h.one('SELECT count(*) AS n FROM availability')?.n, 0)
  await h.click('times', id, member, [String(time1)])
  assert.match((await h.click('clear-times', id, member)).message.content!, /^Your times were cleared/)
  assert.equal(h.one('SELECT count(*) AS n FROM availability')?.n, 0)
})

test('recommendations use deterministic ties; organizers can override, edit and cancel', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  await h.action('nominate', { session: id, game: 'Hades' })
  await h.click('vote', id, member, ['1'])
  await h.click('vote', id, otherMember, ['2'])
  await h.click('times', id, member, [String(time1), String(time2)])
  const data = await details(h.env.DB, (await h.get(id))!)
  assert.equal(recommend(data, at).game?.id, 1)
  assert.equal(recommend(data, at).slot?.starts_at, time1)
  assert.match((await h.action('confirm', { session: id }, { user: member, admin: false })).message.content!, /Only an organizer/)
  await h.action('edit', { session: id, description: 'Bring snacks' })
  assert.equal((await h.get(id))?.description, 'Bring snacks')
  await h.action('close', { session: id })
  assert.equal((await h.get(id))?.status, 'closed')
  await h.action('confirm', { session: id, game: '2', time: String(time2) })
  assert.equal((await h.get(id))?.game_id, 2)
  assert.equal((await h.get(id))?.starts_at, time2)
  assert.equal(h.one("SELECT due_at FROM deliveries WHERE kind = 'reminder'")?.due_at, time2 - 3600)
  const cancelChoices = (now: number) => autocomplete(h.env, {
    type: 4, id, application_id: app, guild_id: server, channel_id: channel, token: 'test-token',
    member: { user: { id: organizer }, permissions: '32' },
    data: { name: 'gamenight', options: [{ name: 'cancel', options: [{ name: 'session', value: '', focused: true }] }] },
  }, now)
  assert.deepEqual((await cancelChoices(at)).map(choice => choice.value), [id])
  assert.deepEqual(await cancelChoices(time2 + 7200), [])
  await h.click('going', id, member)
  assert.equal(h.one("SELECT count(*) AS n FROM rsvps WHERE response = 'going'")?.n, 1)
  await h.action('cancel', { session: id })
  assert.deepEqual(await cancelChoices(at), [])
  await h.click('declined', id, member)
  assert.equal((await h.get(id))?.status, 'cancelled')
  assert.equal(h.one('SELECT response FROM rsvps WHERE user_id = ?', member)?.response, 'going')
})

test('weekly schedule retries produce one round; below quorum or without a vote it stays closed', async () => {
  const h = harness()
  await h.configure()
  await h.action('weekly', { open: 'mon 18:00', close: 'thu 18:00', slots: 'fri 20:00, sat 20:00', auto: true })
  await Promise.all([scheduleRounds(h.env.DB, at), scheduleRounds(h.env.DB, at)])
  const id = String(h.one('SELECT id FROM sessions')?.id)
  assert.equal(h.one('SELECT count(*) AS n FROM sessions')?.n, 1)
  assert.equal(h.one('SELECT count(*) AS n FROM slots')?.n, 2)
  await h.action('nominate', { session: id, game: 'Portal 2' })
  await h.click('vote', id, member, ['1'])
  await h.click('times', id, member, [String(time1)])
  const deadline = (await h.get(id))!.deadline
  await Promise.all([scheduleRounds(h.env.DB, deadline), scheduleRounds(h.env.DB, deadline)])
  assert.equal((await h.get(id))?.status, 'closed')
  assert.equal(h.one("SELECT count(*) AS n FROM deliveries WHERE kind = 'closed'")?.n, 1)
  await h.action('weekly', { enabled: false })
  await scheduleRounds(h.env.DB, at + 7 * 86400)
  assert.equal(h.one('SELECT count(*) AS n FROM sessions')?.n, 1)
})

test('weekly auto confirmation requires both a vote and enough future availability', async () => {
  const h = harness()
  await h.configure()
  await h.action('weekly', { open: 'mon 18:00', close: 'thu 18:00', slots: 'fri 20:00, sat 21:00', auto: true })
  await scheduleRounds(h.env.DB, at)
  const id = String(h.one('SELECT id FROM sessions')?.id)
  await h.click('times', id, member, [String(time2)])
  await h.click('times', id, otherMember, [String(time2)])
  const deadline = (await h.get(id))!.deadline
  await scheduleRounds(h.env.DB, deadline)
  assert.equal((await h.get(id))?.status, 'closed')
  assert.equal((await h.get(id))?.game_id, null)

  const next = at + 7 * 86400
  await scheduleRounds(h.env.DB, next)
  const nextId = String(h.one('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1')?.id)
  await h.action('nominate', { session: nextId, game: 'Portal 2' }, { now: next })
  await h.click('vote', nextId, member, ['1'], { now: next })
  for (const user of [member, otherMember]) await h.click('times', nextId, user, [String(time2 + 7 * 86400)], { now: next })
  await scheduleRounds(h.env.DB, (await h.get(nextId))!.deadline)
  assert.equal((await h.get(nextId))?.status, 'confirmed')
  assert.equal((await h.get(nextId))?.starts_at, time2 + 7 * 86400)
})

test('time conversion handles both DST transitions and explicit UTC offsets', () => {
  const zone = canonicalZone('America/New_York')
  assert.throws(() => canonicalZone('nonsense/Zone'), /IANA/)
  assert.throws(() => parseTime('2026-03-08 02:30', zone), /ambiguous or skipped/)
  assert.throws(() => parseTime('2026-11-01 01:30', zone), /ambiguous or skipped/)
  assert.throws(() => parseTime('2026-02-30 12:00Z', zone), /valid calendar/)
  assert.equal(parseTime('2026-11-01 01:30-05:00', zone), parseTime('2026-11-01 06:30Z', zone))
  const weekly = parseWeekly('mon 20:00', 'fri 20:00', 'sun 02:30', false, null)
  const beforeSpring = weeklyWindow(parseTime('2026-03-03 02:00Z', zone), zone, weekly)
  assert.equal(beforeSpring.slots[0], parseTime('2026-03-08 07:30Z', zone))
  const overlap = weeklyWindow(parseTime('2026-10-27 02:00Z', zone), zone,
    parseWeekly('mon 20:00', 'fri 20:00', 'sun 01:30', false, null))
  assert.equal(overlap.slots[0], parseTime('2026-11-01 05:30Z', zone))
})

test('create suggests selectable dates and times in the server time zone', async () => {
  const h = harness()
  await h.action('configure', { channel, timezone: 'America/New_York', organizer_role: role })
  const complete = (name: 'date' | 'time', value: string, date?: string, memberRoles = [role]) => autocomplete(h.env, {
    type: 4, application_id: app, guild_id: server, channel_id: channel, token: 'test-token', id: '200000000000000120',
    member: { user: { id: member }, roles: memberRoles },
    data: { name: 'gamenight', options: [{ name: 'create', options: [
      ...(date ? [{ name: 'date', value: date }] : []), { name, value, focused: true },
    ] }] },
  }, at)
  const dates = await complete('date', '')
  assert.equal(dates.length, 25)
  assert.match(dates[0].name, /Today · Monday, November 16, 2026/)
  assert.equal((await complete('date', 'dec 31'))[0].value, '2026-12-31')
  assert.deepEqual(await complete('date', '', undefined, []), [])
  const date = dates.find(choice => choice.value === '2026-11-20')!.value
  assert.deepEqual(await complete('time', '7 pm', date), [{ name: '7:00 PM', value: '19:00' }])
  assert.deepEqual(await complete('time', '7:30 p', date), [{ name: '7:30 PM', value: '19:30' }])
  assert.deepEqual(await complete('time', ''), [])
  assert.deepEqual(await complete('time', '1 pm', '2026-11-16'), [])
  const created = await h.action('create', { game: 'Portal 2', date, time: '7:30 PM' }, { user: member, admin: false, roles: [role] })
  assert.match(created.message.content!, /Review the game and time/)
  assert.match((await h.click('publish-typed', created.id, member, undefined, { admin: false, roles: [role] })).message.content!, /ready for voting/)
  assert.equal(h.one('SELECT starts_at FROM slots WHERE session_id = ?', created.id)?.starts_at,
    parseTime('2026-11-21 00:30Z', 'UTC'))
})

test('create previews a RAWG match privately and publishes it once after the owner confirms', async t => {
  const h = harness({ RAWG_API_KEY: 'mock-rawg-key' })
  await h.configure()
  const fixture = { id: 992151, name: 'DEATH NOTE Killer Within', slug: 'death-note-killer-within' }
  const catalog = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.origin, 'https://api.rawg.io')
    if (url.pathname.endsWith('/992151')) return Response.json({ ...fixture, publishers: [{ name: 'Bandai Namco' }] })
    const query = url.searchParams.get('search')
    if (query === 'Homebrew') return new Response(null, { status: 503 })
    if (query === 'Doom') return Response.json({ results: [{ id: 1, name: 'Doom' }, { id: 2, name: 'DOOM' }] })
    assert.equal(query, 'Death Note: Killer Within')
    return Response.json({ results: [fixture, { id: 7, name: 'Death Note: Successor' }] })
  })
  t.mock.method(console, 'warn', () => undefined)

  const picked = await h.create({ game: 'Death Note: Killer Within' }, { preview: true })
  assert.match(picked.message.embeds![0].description!, /Publisher\*\* Bandai Namco/)
  assert.match(picked.message.embeds![0].description!, new RegExp(`<t:${time1}:F>`))
  assert.match(picked.message.embeds![0].description!, /Seats\*\* No limit/)
  assert.match(JSON.stringify(picked.message.components), /Publish with RAWG match/)
  assert.equal(picked.notify, undefined)
  assert.equal(await h.get(picked.id), null)
  assert.equal(h.one('SELECT count(*) AS n FROM deliveries')?.n, 0)
  assert.match((await h.click('publish-catalog', picked.id, organizer, undefined, {
    admin: true, guild: otherServer, channel: otherChannel,
  })).message.content!, /preview expired or was already handled/)
  assert.equal(await h.get(picked.id), null)
  assert.equal((await h.click('publish-catalog', picked.id, member)).notify, undefined)
  assert.equal((await h.click('publish-catalog', picked.id, organizer, undefined, { admin: false })).notify, undefined)

  const publish = () => h.click('publish-catalog', picked.id, organizer, undefined, { admin: true })
  const confirmations = await Promise.all([publish(), publish()])
  assert.equal(confirmations.filter(result => result.notify === picked.id).length, 1)
  assert.equal(h.one('SELECT rawg_id FROM games WHERE session_id = ?', picked.id)?.rawg_id, 992151)
  assert.equal(h.one('SELECT count(*) AS n FROM create_drafts')?.n, 0)
  const data = await details(h.env.DB, (await h.get(picked.id))!)
  const opening = await statement(h.env.DB, "SELECT * FROM deliveries WHERE session_id = ? AND kind = 'open'", picked.id).first<Delivery>()
  assert.ok(opening)
  const announced = board(data, at, opening).embeds![0].description!
  assert.match(announced, /Leading game\*\* No votes yet/)
  assert.match(announced, /About DEATH NOTE Killer Within\*\*\n\*\*Publisher\*\* Bandai Namco/)
  const liveDetails = await h.click('show', picked.id, member)
  assert.match(liveDetails.message.embeds![0].description!, /Publisher\*\* Bandai Namco/)
  assert.equal(catalog.mock.callCount(), 2)
  const manual = await h.create({ game: 'Homebrew', verify_game: false }, { now: at + 10, preview: true })
  assert.match(manual.message.embeds![0].description!, /couldn’t verify a single RAWG match/)
  assert.match((await h.click('publish-typed', manual.id, organizer, undefined, { admin: true, now: at + 10 })).message.content!, /ready for voting/)
  assert.equal(h.one('SELECT rawg_id FROM games WHERE session_id = ?', manual.id)?.rawg_id, null)
  assert.equal(catalog.mock.callCount(), 2)
  const unavailable = await h.create({ game: 'Homebrew' }, { now: at + 10, preview: true })
  assert.match(unavailable.message.embeds![0].description!, /couldn’t verify a single RAWG match/)
  assert.equal(unavailable.notify, undefined)
  assert.equal(await h.get(unavailable.id), null)
  assert.match((await h.click('publish-typed', unavailable.id, organizer, undefined, { admin: true, now: at + 10 })).message.content!, /ready for voting/)
  assert.equal(h.one('SELECT rawg_id FROM games WHERE session_id = ?', unavailable.id)?.rawg_id, null)
  const ambiguous = await h.create({ game: 'Doom' }, { now: at + 20, preview: true })
  assert.match(ambiguous.message.embeds![0].description!, /couldn’t verify a single RAWG match/)
  assert.doesNotMatch(JSON.stringify(ambiguous.message.components), /Publish with RAWG match/)
  assert.match((await h.click('discard-draft', ambiguous.id, organizer, undefined, { now: at + 20 })).message.content!, /discarded/)
  assert.equal(await h.get(ambiguous.id), null)
  assert.equal(catalog.mock.callCount(), 5)
})

test('an expired creation preview cannot publish and is removed by scheduling', async t => {
  const h = harness({ RAWG_API_KEY: 'mock-rawg-key' })
  await h.configure()
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [] }))
  const draft = await h.create({}, { preview: true })
  await h.action('configure', { timezone: 'America/New_York' })
  const shifted = await h.click('publish-typed', draft.id, organizer, undefined, { admin: true })
  assert.match(shifted.message.content!, /time zone changed/)
  assert.equal(await h.get(draft.id), null)
  const expired = await h.click('publish-typed', draft.id, organizer, undefined, { admin: true, now: at + 901 })
  assert.match(expired.message.content!, /preview expired/)
  assert.equal(await h.get(draft.id), null)
  await scheduleRounds(h.env.DB, at + 901)
  assert.equal(h.one('SELECT count(*) AS n FROM create_drafts')?.n, 0)
})

test('guild and channel scope gate writes, details, autocomplete and public data', async () => {
  const h = harness()
  await h.configure()
  await h.action('configure', { channel: otherChannel }, { guild: otherServer, channel: otherChannel })
  const { id } = await h.create()
  assert.match((await h.click('going', id, member, [], { guild: otherServer, channel: otherChannel })).message.content!, /this channel/)
  assert.match((await h.click('show', id, member, [], { channel: otherChannel })).message.content!, /this channel/)
  const complete = await autocomplete(h.env, {
    type: 4, id, application_id: app, token: 'fake', guild_id: otherServer, channel_id: otherChannel,
    member: { user: { id: member } },
    data: { name: 'gamenight', options: [{ name: 'show', options: [{ name: 'session', value: '', focused: true }] }] },
  }, at)
  assert.deepEqual(complete, [])
  await h.click('going', id, member)
  const external = 'https://companion.example.com'
  const opts = { ...h.env, PUBLIC_GUILD_ID: server, PUBLIC_CHANNEL_ID: channel, DISCORD_GUILD_ID: server, WEB_ORIGIN: external }
  const request = (origin: string) => new Request('https://api.example.com/api/schedule', { headers: { Origin: origin } })
  assert.equal((await publicSchedule(h.env, request('https://api.example.com'), at)).status, 404)
  assert.equal((await publicSchedule(opts, request('https://other.example'), at)).status, 403)
  const response = await publicSchedule(opts, request(external), at)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), external)
  const text = await response.text()
  assert.doesNotMatch(text, new RegExp(member))
  const { sessions } = JSON.parse(text)
  assert.equal(sessions[0].response_counts.going, 1)
  assert.equal(sessions[0].games[0].name, 'Overcooked')
})

test('signed interaction HTTP handler acknowledges within Discord protocol and patches an ephemeral result', async t => {
  const h = harness()
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const hex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('hex')
  const env = { ...h.env, DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', keys.publicKey)) }
  async function request(body: object, offset = 0, alter = false) {
    const time = String(nowSeconds() + offset)
    const text = JSON.stringify(body)
    const sig = await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(time + text))
    return new Request('https://worker.example/discord/interactions', {
      method: 'POST', body: text + (alter ? ' ' : ''),
      headers: { 'X-Signature-Ed25519': hex(sig), 'X-Signature-Timestamp': time },
    })
  }
  const work: Promise<unknown>[] = []
  const ctx = { waitUntil: (promise: Promise<unknown>) => work.push(promise) } as unknown as ExecutionContext
  const ping = { application_id: app, type: 1 }
  assert.deepEqual(await (await worker.fetch(await request(ping), env, ctx)).json(), { type: 1 })
  assert.equal((await worker.fetch(await request(ping, 0, true), env, ctx)).status, 401)
  assert.equal((await worker.fetch(await request(ping, -301), env, ctx)).status, 401)
  assert.equal((await worker.fetch(await request({ ...ping, application_id: otherServer }), env, ctx)).status, 401)

  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /messages\/@original$/)
    assert.equal(options.method, 'PATCH')
    assert.equal(options.redirect, 'manual')
    const body = JSON.parse(String(options.body))
    assert.match(body.content, /New sessions|preview expired or was already handled/)
    assert.deepEqual(body.allowed_mentions, { parse: [] })
    assert.deepEqual(body.components, [])
    return Response.json({ id: '998000000000000001' })
  })
  const command: Interaction = {
    type: 2, application_id: app, guild_id: server, channel_id: channel, token: 'mock-token', id: '200000000000000100',
    member: { user: { id: organizer }, permissions: '32' },
    data: { name: 'gamenight', options: [{ name: 'configure', options: [{ name: 'channel', value: channel }] }] },
  }
  assert.deepEqual(await (await worker.fetch(await request(command), env, ctx)).json(),
    { type: 5, data: { flags: 64, allowed_mentions: { parse: [] } } })
  await Promise.all(work)
  assert.equal(fetch.mock.callCount(), 1)
  const draftClick = { ...command, id: '200000000000000101', type: 3,
    data: { custom_id: 'gn:discard-draft:200000000000000102' } }
  assert.deepEqual(await (await worker.fetch(await request(draftClick), env, ctx)).json(), { type: 6 })
  await Promise.all(work)
  assert.equal(fetch.mock.callCount(), 2)
})

test('outbox honors 429, reconciles an ambiguous send, and never sends twice on retry', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const env: Env = { ...h.env, DISCORD_BOT_TOKEN: 'mock-token' }
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at * 1000) })
  const time = nowSeconds()
  const messageId = '998000000000000001'
  let sent: { embeds: [{ footer: { text: string } }] } | undefined
  let posts = 0
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.method === 'GET') return Response.json([{ id: messageId, author: { id: app }, embeds: sent?.embeds }])
    posts++
    if (posts === 1) return Response.json({ retry_after: 10 }, { status: 429 })
    sent = JSON.parse(String(options.body))
    throw new Error('mock transport interruption after accepting the message')
  })
  await Promise.all([deliverPending(env, time, id), deliverPending(env, time, id)])
  assert.equal(posts, 1)
  assert.equal(h.one('SELECT next_at FROM deliveries')?.next_at, time + 10)
  await deliverPending(env, time + 10, id)
  await deliverPending(env, time + 80, id)
  await deliverPending(env, time + 90, id)
  assert.equal(posts, 2)
  assert.equal(fetch.mock.callCount(), 3)
  assert.equal(h.one('SELECT state FROM deliveries')?.state, 'sent')
  assert.equal(h.one('SELECT message_id FROM deliveries')?.message_id, messageId)
})

test('calendar downloads have stable IDs, precise UTC time, proper escaping and folding', () => {
  const event = {
    id: 'event-1', start: time1, decidedAt: at, duration: 120, summary: 'Play; Villa, Reunion',
    location: 'Discord', description: 'A'.repeat(72) + '🎮\nPack snacks',
  }
  const { data, google } = calendar(event)
  assert.match(data, /UID:event-1@play-villa\r\n/)
  assert.ok(data.includes('SUMMARY:Play\\; Villa\\, Reunion'))
  assert.match(data, /DTSTART:20261120T200000Z\r\nDTEND:20261120T220000Z/)
  assert.ok(data.split('\r\n').every(line => Buffer.byteLength(line) <= 75))
  assert.ok(data.includes('\\nPack snacks'))
  assert.equal(new URL(google).searchParams.get('dates'), '20261120T200000Z/20261120T220000Z')
})

test('reference constraints reject confirmations tied to a different session', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const { id: other } = await h.create({ game: 'Hades' })
  const item = await statement(h.env.DB, 'SELECT * FROM sessions WHERE id = ?', other).first<Session>()
  assert.ok(item)
  await assert.rejects(statement(h.env.DB, 'UPDATE sessions SET game_id = 2 WHERE id = ?', id).run(), /constraint/i)
})

test('RAWG search and selection save details for the picked game while protecting keys and artwork', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  assert.match((await h.action('search', { query: 'Port' })).message.content!, /disabled/)
  const env = { ...h.env, RAWG_API_KEY: 'mock-rawg-key' }
  const search = t.mock.method(globalThis, 'fetch', async (request: URL, options: RequestInit) => {
    assert.equal(request.origin, 'https://api.rawg.io')
    assert.equal(request.searchParams.get('key'), 'mock-rawg-key')
    assert.equal(options.redirect, 'manual')
    const game = {
      id: 123, name: 'Portal 2', slug: 'portal-2', background_image: 'https://untrusted.example/test.jpg',
      platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 3' } }, null],
      genres: [{ name: 'Puzzle' }], released: '2011-04-19',
    }
    if (request.pathname.endsWith('/123')) return Response.json({ ...game, publishers: [{ name: 'Valve' }] })
    return Response.json({ results: request.searchParams.get('search') === 'Unknown' ? [] : [game] })
  })
  let sequence = 0
  function lookup(name: string, values: Record<string, string | number>, time: number) {
    return handleInteraction(env, {
      type: 2, application_id: app, guild_id: server, channel_id: channel, token: 'mock-token',
      id: String(300000000000000000n + BigInt(++sequence)), member: { user: { id: member } },
      data: { name: 'gamenight', options: [{ name, options: Object.entries(values).map(([name, value]) => ({ name, value })) }] },
    }, time)
  }
  const result = await lookup('search', { query: 'Portal', session: id }, at)
  assert.match(result.message.content!, /Game data by RAWG/)
  assert.match(result.message.embeds![0].description!, /PC, PlayStation 3 · Puzzle · 2011/)
  assert.doesNotMatch(JSON.stringify(result.message), /mock-rawg-key|untrusted\.example/)
  assert.match((await lookup('search', { query: 'Portal' }, at + 1)).message.content!, /wait ten seconds/)

  const [row] = result.message.components! as { components: { custom_id: string; options: { value: string }[] }[] }[]
  const [menu] = row.components
  const control = {
    type: 3, application_id: app, guild_id: server, channel_id: channel, token: 'mock-token',
    id: '400000000000000001', member: { user: { id: member } },
    data: { custom_id: menu.custom_id, values: [menu.options[0].value] },
  }
  assert.match((await handleInteraction(env, { ...control, channel_id: otherChannel }, at + 1)).message.content!, /this channel/)
  const picked = await handleInteraction(env, control, at + 1)
  assert.match(picked.message.content!, /Added \*\*Portal 2\*\*/)
  assert.match(picked.message.content!, /Publisher\*\* Valve/)
  assert.match((await lookup('nominate', { session: id, rawg_id: 123 }, at + 2)).message.content!, /wait ten seconds/)
  assert.match((await lookup('nominate', { session: id, rawg_id: 123 }, at + 11)).message.content!, /already listed/)
  assert.match((await lookup('search', { query: 'Unknown', session: id }, at + 11)).message.content!, /custom game name/)
  const saved = h.one('SELECT image, crossplay FROM games WHERE rawg_id = 123')
  assert.equal(saved?.image, null)
  assert.equal(saved?.crossplay, null)
  assert.equal(search.mock.callCount(), 4)

  const selectedId = String(h.one('SELECT id FROM games WHERE rawg_id = 123')?.id)
  await h.action('confirm', { session: id, game: selectedId, time: String(time1) })
  const board = (await h.action('show', { session: id })).message.embeds![0].description!
  assert.match(board, /Platforms\*\* PC, PlayStation 3/)
  assert.match(board, /Publisher\*\* Valve/)
  assert.match((await handleInteraction(env, control, at + 12)).message.content!, /Voting has closed/)
  const response = await publicSchedule({ ...env, PUBLIC_GUILD_ID: server, PUBLIC_CHANNEL_ID: channel },
    new Request('https://example.com/api/schedule'), at)
  const { sessions } = await response.json() as { sessions: { games: { rawg_id: number; details: object }[] }[] }
  assert.deepEqual(sessions[0].games.find(game => game.rawg_id === 123)?.details, {
    platforms: ['PC', 'PlayStation 3'], genres: ['Puzzle'], released: '2011-04-19',
    publisher: 'Valve', sourceUrl: 'https://rawg.io/games/portal-2',
  })
})

test('manual nominees can carry editable notes without a RAWG key', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  const result = await h.action('nominate', { session: id, game: 'Homebrew tabletop', notes: 'Bring a pencil.' }, { user: member, admin: false })
  assert.match(result.message.content!, /Game note\*\* Bring a pencil/)
  const game = String(h.one("SELECT id FROM games WHERE name = 'Homebrew tabletop'")?.id)
  await h.action('tag', { session: id, game, clear_notes: true })
  assert.equal(h.one('SELECT game_details FROM games WHERE id = ?', game)?.game_details, '{}')
  await h.action('tag', { session: id, game, notes: 'Bring a pencil and dice.' })
  await h.action('confirm', { session: id, game, time: String(time1) })
  assert.match((await h.action('show', { session: id })).message.embeds![0].description!, /pencil and dice/)
})

test('RAWG search only offers automatic nomination when exactly one ballot is open in the channel', async t => {
  const h = harness({ RAWG_API_KEY: 'mock-rawg-key' })
  await h.configure()
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [{ id: 123, name: 'Portal 2' }] }))
  const search = (now: number) => h.action('search', { query: 'Portal 2' }, { now })

  const none = await search(at)
  assert.match(none.message.content!, /no open game night.*\/gamenight create/)
  assert.equal(none.message.components, undefined)
  const { id } = await h.create({ verify_game: false })
  const one = await search(at + 10)
  assert.match(one.message.content!, /nominate for.*Overcooked/)
  assert.match(JSON.stringify(one.message.components), new RegExp(`gn:rawg:${id}`))
  assert.equal(h.one('SELECT count(*) AS n FROM games WHERE rawg_id = 123')?.n, 0)
  await h.create({ game: 'Another night', verify_game: false })
  const multiple = await search(at + 20)
  assert.match(multiple.message.content!, /More than one game night is open/)
  assert.equal(multiple.message.components, undefined)
  await h.action('close', { session: id })
  assert.match((await search(at + 30)).message.content!, /nominate for.*Another night/)
})

test('RAWG retries a temporary upstream failure once and reports rate limits without retrying them', async t => {
  const h = harness({ RAWG_API_KEY: 'mock-rawg-key' })
  await h.configure()
  let attempts = 0
  const upstream = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    if (url.searchParams.get('search') === 'Throttle') return new Response(null, { status: 429 })
    if (++attempts === 1) return new Response(null, { status: 503 })
    return Response.json({ results: [{ id: 123, name: 'Portal 2' }] })
  })
  const warnings = t.mock.method(console, 'warn', () => undefined)
  const recovered = await h.action('search', { query: 'Portal 2' })
  assert.match(recovered.message.embeds![0].description!, /Portal 2/)
  assert.equal(upstream.mock.callCount(), 2)
  assert.equal(warnings.mock.callCount(), 0)
  const throttled = await h.action('search', { query: 'Throttle' }, { now: at + 10 })
  assert.match(throttled.message.content!, /RAWG is limiting requests/)
  assert.equal(upstream.mock.callCount(), 3)
  assert.deepEqual(warnings.mock.calls[0].arguments, ['RAWG lookup failed', 429])
})

test('a cancelled session cannot send its previously scheduled reminder', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  await h.action('confirm', { session: id, game: '1', time: String(time1) })
  await h.action('cancel', { session: id })
  const env = { ...h.env, DISCORD_BOT_TOKEN: 'mock-token' }
  const time = time1 - 3600
  t.mock.timers.enable({ apis: ['Date'], now: new Date(time * 1000) })
  const send = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.match(String(options.body), /was cancelled/)
    return Response.json({ id: '998000000000000001' })
  })
  await deliverPending(env, time)
  await deliverPending(env, time)
  assert.equal(h.one("SELECT state FROM deliveries WHERE kind = 'reminder'")?.state, 'skipped')
  assert.equal(h.one("SELECT state FROM deliveries WHERE kind = 'cancelled'")?.state, 'sent')
  assert.equal(send.mock.callCount(), 1)
})

test('upgrading a populated D1 preserves RSVPs and Discord delivery IDs', () => {
  const db = database(false)
  db.apply('0001_game_nights.sql')
  db.sqlite.exec(`
    INSERT INTO guilds (id, channel_id) VALUES ('${server}', '${channel}');
    INSERT INTO sessions (id, guild_id, channel_id, title, timezone, created_at, deadline, duration, reminder, minimum)
    VALUES ('old', '${server}', '${channel}', 'Old night', 'UTC', ${at}, ${at + 60}, 120, 60, 2);
    INSERT INTO rsvps VALUES ('old', '${member}', 'going');
    INSERT INTO games (session_id, name, name_key, rawg_id) VALUES ('old', 'Portal 2', 'portal 2', 123);
    INSERT INTO search_limits VALUES ('${server}', ${at + 10});
    UPDATE deliveries SET state = 'sent', message_id = '998000000000000001';
  `)
  db.apply('0002_game_night_upgrades.sql')
  db.apply('0003_game_details.sql')
  assert.equal(db.sqlite.prepare('SELECT game_details FROM game_tally WHERE rawg_id = 123').get()?.game_details, '{}')
  assert.equal(db.sqlite.prepare('SELECT next_at FROM search_limits WHERE guild_id = ?').get(server)?.next_at, at + 10)
  assert.equal(db.sqlite.prepare("SELECT needs_reconfirm FROM rsvps WHERE session_id = 'old'").get()?.needs_reconfirm, 0)
  assert.equal(db.sqlite.prepare("SELECT message_id FROM deliveries WHERE session_id = 'old'").get()?.message_id, '998000000000000001')
  db.apply('0004_create_drafts.sql')
  db.apply('0005_refresh_boards.sql')
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM board_updates').get()?.n, 0)
  db.sqlite.exec(`INSERT INTO votes SELECT 'old', '${member}', id FROM games WHERE session_id = 'old'`)
  assert.deepEqual({ ...db.sqlite.prepare("SELECT generation, synced FROM board_updates WHERE session_id = 'old'").get() },
    { generation: 1, synced: 0 })
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), [])
})

test('rescheduling keeps the game and session, invalidates old RSVP buttons, and replaces the reminder', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create({ capacity: 2 })
  await h.action('confirm', { session: id, game: '1', time: String(time1) })
  await h.click('going', id, member)
  await h.click('maybe', id, otherMember)
  const moved = await h.action('reschedule', { session: id, time: '2026-11-22 21:00Z' })
  assert.match(moved.message.content!, /moved/)
  const item = (await h.get(id))!
  assert.equal(item.revision, 1)
  assert.equal(item.game_id, 1)
  assert.equal(item.starts_at, parseTime('2026-11-22 21:00Z', 'UTC'))
  assert.equal(h.one('SELECT count(*) AS n FROM rsvps WHERE needs_reconfirm = 1')?.n, 2)
  assert.match((await h.click('going', id, member)).message.content!, /game night moved/)
  assert.match((await h.click('going', id + ':1', member)).message.content!, /saved/)
  assert.equal(h.one('SELECT count(*) AS n FROM rsvps WHERE needs_reconfirm = 1')?.n, 1)
  await h.action('reschedule', { session: id, time: '2026-11-22 21:00Z' })
  assert.equal(h.one("SELECT count(*) AS n FROM deliveries WHERE kind = 'rescheduled'")?.n, 1)

  const originalReminder = time1 - 3600
  t.mock.timers.enable({ apis: ['Date'], now: new Date(originalReminder * 1000) })
  const sent = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body))
    assert.match(body.embeds[0].title, /Rescheduled/)
    return Response.json({ id: '998000000000000001' })
  })
  const env = { ...h.env, DISCORD_BOT_TOKEN: 'test-token' }
  await deliverPending(env, originalReminder)
  await deliverPending(env, originalReminder)
  assert.equal(sent.mock.callCount(), 1)
  assert.equal(h.one("SELECT state FROM deliveries WHERE kind = 'reminder' AND revision = 0")?.state, 'skipped')
  assert.equal(h.one("SELECT due_at FROM deliveries WHERE kind = 'reminder' AND revision = 1")?.due_at, item.starts_at! - 3600)

  const site = await publicSchedule({ ...h.env, PUBLIC_GUILD_ID: server, PUBLIC_CHANNEL_ID: channel },
    new Request('https://worker.example/api/schedule'), at)
  const body = await site.json()
  assert.equal(body.sessions[0].revision, 1)
  assert.equal(body.sessions[0].response_counts.reconfirm, 1)
  const exported = calendar({ id, start: item.starts_at, revision: 1, duration: 120,
    decidedAt: item.decided_at, summary: 'Game night', description: '', location: 'Discord' })
  assert.match(exported.data, new RegExp(`UID:${id}@play-villa`))
  assert.match(exported.data, /SEQUENCE:1/)
})

test('a full confirmed night offers freed seats in order and expires unclaimed holds', async t => {
  const h = harness()
  const nextMember = '100000000000000009'
  const newcomer = '100000000000000010'
  await h.configure()
  const { id } = await h.create({ capacity: 1 })
  await h.action('confirm', { session: id, game: '1', time: String(time1) })
  await h.click('going', id, member)
  assert.match((await h.click('going', id, otherMember)).message.content!, /#1 on the waitlist/)
  assert.match((await h.click('going', id, nextMember)).message.content!, /#2 on the waitlist/)
  await h.click('declined', id, member)
  assert.equal(h.one('SELECT offered_until FROM waitlist WHERE user_id = ?', otherMember)?.offered_until, at + 1800)
  assert.equal(h.one('SELECT offered_until FROM waitlist WHERE user_id = ?', nextMember)?.offered_until, null)
  assert.match((await h.click('going', id, newcomer)).message.content!, /waitlist/)
  assert.equal(h.one("SELECT count(*) AS n FROM rsvps WHERE response = 'going'")?.n, 0)
  await scheduleRounds(h.env.DB, at + 1800)
  assert.equal(h.one('SELECT offered_until FROM waitlist WHERE user_id = ?', nextMember)?.offered_until, at + 3600)
  assert.equal(h.one('SELECT id FROM waitlist WHERE user_id = ?', otherMember), undefined)

  t.mock.timers.enable({ apis: ['Date'], now: new Date((at + 1800) * 1000) })
  const offers: { content: string; allowed_mentions: { users?: string[] } }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body))
    if (body.embeds[0].title === 'A game night spot opened') offers.push(body)
    return Response.json({ id: '998000000000000001' })
  })
  const env = { ...h.env, DISCORD_BOT_TOKEN: 'test-token' }
  await deliverPending(env, at + 1800)
  await deliverPending(env, at + 1800)
  assert.deepEqual(offers.map(offer => offer.allowed_mentions), [{ parse: [], users: [nextMember] }])
  assert.equal(offers[0].content, `<@${nextMember}>`)
  assert.match((await h.click('going', id, nextMember, undefined, { now: at + 1801 })).message.content!, /saved/)
  assert.equal(h.one("SELECT count(*) AS n FROM rsvps WHERE response = 'going'")?.n, 1)
  assert.equal(h.one("SELECT count(*) AS n FROM deliveries WHERE kind = 'offer'")?.n, 2)
})

test('party filters require all tagged platforms and the group size, and surprise keeps votes unchanged', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  await h.action('tag', { session: id, game: '1', platforms: 'PC,Xbox', crossplay: true, min_players: 2, max_players: 4 })
  await h.action('nominate', { session: id, game: 'Another game', platforms: 'PC', crossplay: false, max_players: 5 })
  await h.click('vote', id, member, ['2'])
  const match = await h.action('shortlist', { session: id, platforms: 'pc, xbox', crossplay: true, players: 3, surprise: true })
  assert.match(match.message.content!, /Surprise pick.*Overcooked/)
  assert.doesNotMatch(match.message.content!, /Another game/)
  assert.match((await h.action('shortlist', { session: id, platforms: 'xbox', players: 5 })).message.content!, /No nominated games match/)
  assert.match((await h.action('tag', { session: id, game: '1', max_players: 1 })).message.content!, /player range/)
  assert.match((await h.click('surprise', id, member)).message.content!, /Surprise pick/)
  assert.equal(h.one('SELECT game_id FROM votes WHERE user_id = ?', member)?.game_id, 2)
})

test('a rematch copies the confirmed game and its setup while starting fresh ballots', async () => {
  const h = harness()
  await h.action('configure', { channel, voice: otherChannel, timezone: 'UTC', duration: 90 })
  const { id } = await h.create({ capacity: 4 })
  await h.action('tag', { session: id, game: '1', platforms: 'PC, Xbox', crossplay: true, max_players: 4, notes: 'Use the base game.' })
  await h.click('vote', id, member, ['1'])
  await h.click('going', id, member)
  await h.action('confirm', { session: id, game: '1', time: String(time1) })
  const rematch = { session: id, time: '2026-11-28 20:00Z' }
  assert.match((await h.action('rematch', rematch)).message.content!, /completed/)
  await h.action('configure', { clear_voice: true, duration: 120 })
  const again = await h.action('rematch', rematch, { now: time1 + 7200 })
  const item = (await h.get(again.id))!
  assert.equal(item.status, 'open')
  assert.equal(item.capacity, 4)
  assert.equal(item.duration, 90)
  assert.equal(item.voice_id, otherChannel)
  assert.equal(h.one('SELECT max_players FROM games WHERE session_id = ?', again.id)?.max_players, 4)
  assert.equal(h.one("SELECT json_extract(game_details, '$.notes') AS note FROM games WHERE session_id = ?", again.id)?.note, 'Use the base game.')
  assert.equal(h.one('SELECT count(*) AS n FROM votes WHERE session_id = ?', again.id)?.n, 0)
  assert.equal(h.one('SELECT count(*) AS n FROM rsvps WHERE session_id = ?', again.id)?.n, 0)
})

test('Discord Events are opt-in and an ambiguous create reconciles before updates and cancellation', async t => {
  const h = harness()
  await h.configure()
  const withoutEvents = await h.create()
  await h.action('confirm', { session: withoutEvents.id, game: '1', time: String(time1) })
  assert.equal(h.one('SELECT count(*) AS n FROM discord_events')?.n, 0)

  await h.action('configure', { discord_events: true })
  const created = await h.create({ game: 'Event test' })
  const gameId = String(h.one('SELECT id FROM games WHERE session_id = ?', created.id)?.id)
  await h.action('confirm', { session: created.id, game: gameId, time: String(time1) })
  const env = { ...h.env, DISCORD_BOT_TOKEN: 'mock-token' }
  const eventId = '998000000000000012'
  let published: { id: string; creator_id: string; description: string } | null = null
  let creates = 0
  const patches: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, new RegExp(`/guilds/${server}/scheduled-events`))
    if (options.method === 'POST') {
      creates++
      const body = JSON.parse(String(options.body))
      assert.equal(body.privacy_level, 2)
      assert.equal(body.entity_type, 3)
      assert.equal(body.scheduled_start_time, new Date(time1 * 1000).toISOString())
      assert.equal(body.allowed_mentions, undefined)
      published = { id: eventId, creator_id: app, description: body.description }
      throw new Error('mock transport interruption after creating the event')
    }
    if (options.method === 'PATCH') {
      assert.ok(url.endsWith(eventId))
      patches.push(JSON.parse(String(options.body)))
      return Response.json({ ...published })
    }
    if (url.endsWith(eventId)) return Response.json({ ...published, status: 1 })
    return Response.json([{ ...published, creator_id: otherServer }, published])
  })
  await Promise.all([syncEvents(env, at, created.id), syncEvents(env, at, created.id)])
  assert.equal(creates, 1)
  assert.equal(h.one('SELECT event_id FROM discord_events')?.event_id, null)
  await syncEvents(env, at + 60, created.id)
  assert.equal(h.one('SELECT event_id FROM discord_events')?.event_id, eventId)
  await syncEvents(env, at + 61, created.id)
  await h.action('reschedule', { session: created.id, time: '2026-11-22 21:00Z' }, { now: at + 62 })
  await syncEvents(env, at + 62, created.id)
  assert.equal(patches.at(-1)?.scheduled_start_time, '2026-11-22T21:00:00.000Z')
  await h.action('configure', { discord_events: false }, { now: at + 63 })
  await h.action('cancel', { session: created.id }, { now: at + 63 })
  await syncEvents(env, at + 63, created.id)
  assert.deepEqual(patches.at(-1), { status: 4 })
  assert.equal(h.one('SELECT event_id FROM discord_events')?.event_id, null)
  assert.equal(creates, 1)
})
