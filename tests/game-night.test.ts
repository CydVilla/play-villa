import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../worker/index.ts'
import { deliverPending } from '../worker/delivery.ts'
import { autocomplete, handleInteraction, type Interaction } from '../worker/interactions.ts'
import { publicSchedule } from '../worker/public.ts'
import { scheduleRounds } from '../worker/schedule.ts'
import { details, recommend, session, statement } from '../worker/store.ts'
import { canonicalZone, parseTime, parseWeekly, weeklyWindow } from '../worker/time.ts'
import { nowSeconds, type Env, type Session } from '../worker/types.ts'
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

function harness() {
  const db = database()
  const env = { DB: db as unknown as D1Database, DISCORD_APPLICATION_ID: app }
  let sequence = 0
  const action = async (name: string, fields: Record<string, string | number | boolean> = {},
    settings: { user?: string; admin?: boolean; roles?: string[]; guild?: string; channel?: string; now?: number; id?: string } = {},
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
  const create = (fields = {}, settings = {}) => action('create', {
    game: 'Overcooked', time: '2026-11-20 20:00Z', alternatives: '2026-11-21 21:00Z', ...fields,
  }, settings)
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
    h.create({}, { id, user: member, admin: false, roles: [role] }),
    h.create({}, { id, user: member, admin: false, roles: [role] }),
  ])
  assert.equal(results.filter(result => result.message.content?.includes('already handled')).length, 1)
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

test('availability is replaceable, invalid slots preserve the ballot, and RSVP limits are atomic', async () => {
  const h = harness()
  await h.configure()
  const { id } = await h.create({ capacity: 1 })
  const menu = await h.click('time-menu', id, member)
  assert.match(JSON.stringify(menu.message), /"max_values":2/)
  await h.click('times', id, member, [String(time1), String(time2)])
  assert.equal(h.one('SELECT count(*) AS n FROM availability')?.n, 2)
  await h.click('times', id, member, [String(time2), '1234'])
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
  await h.click('clear-times', id, member)
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
  await h.click('going', id, member)
  assert.equal(h.one("SELECT count(*) AS n FROM rsvps WHERE response = 'going'")?.n, 1)
  await h.action('cancel', { session: id })
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
    const body = JSON.parse(String(options.body))
    assert.match(body.content, /New sessions/)
    assert.deepEqual(body.allowed_mentions, { parse: [] })
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

test('RAWG lookup is optional, server-side, throttled, and rejects an untrusted image host', async t => {
  const h = harness()
  await h.configure()
  const { id } = await h.create()
  assert.match((await h.action('search', { query: 'Port' })).message.content!, /disabled/)
  const env = { ...h.env, RAWG_API_KEY: 'mock-rawg-key' }
  const search = t.mock.method(globalThis, 'fetch', async (request: URL) => {
    assert.equal(request.origin, 'https://api.rawg.io')
    assert.equal(request.searchParams.get('key'), 'mock-rawg-key')
    const game = { id: 123, name: 'Portal 2', background_image: 'https://untrusted.example/test.jpg' }
    return Response.json(request.pathname.endsWith('/123') ? game : { results: [game] })
  })
  function lookup(name: string, values: { name: string; value: string | number }[], time: number, n: number) {
    return handleInteraction(env, {
      type: 2, application_id: app, guild_id: server, channel_id: channel, token: 'mock-token',
      id: String(300000000000000000n + BigInt(n)), member: { user: { id: member } },
      data: { name: 'gamenight', options: [{ name, options: values }] },
    }, time)
  }
  const result = await lookup('search', [{ name: 'query', value: 'Portal' }], at, 1)
  assert.match(result.message.content!, /Game data by RAWG/)
  assert.doesNotMatch(result.message.content!, /mock-rawg-key/)
  const nomination = [{ name: 'session', value: id }, { name: 'rawg_id', value: 123 }]
  assert.match((await lookup('nominate', nomination, at + 1, 2)).message.content!, /wait ten seconds/)
  assert.match((await lookup('nominate', nomination, at + 10, 3)).message.content!, /Added/)
  assert.equal(h.one('SELECT image FROM games WHERE rawg_id = 123')?.image, null)
  assert.equal(search.mock.callCount(), 2)
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
