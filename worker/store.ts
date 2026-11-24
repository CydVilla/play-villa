import { InputError, type Game, type GameTags, type Guild, type Param, type RSVP, type Session, type Slot } from './types.ts'

export function statement(db: D1Database, sql: string, ...args: Param[]) {
  return db.prepare(sql).bind(...args)
}

export async function rows<T>(db: D1Database, sql: string, ...args: Param[]) {
  return (await statement(db, sql, ...args).all<T>()).results
}

export function guild(db: D1Database, id: string) {
  return statement(db, 'SELECT * FROM guilds WHERE id = ?', id).first<Guild>()
}

export function session(db: D1Database, guildId: string, id: string) {
  return statement(db, 'SELECT * FROM sessions WHERE guild_id = ? AND id = ?', guildId, id).first<Session>()
}

export async function mutate(
  db: D1Database, interactionId: string, now: number, queries: (gate: string) => D1PreparedStatement[],
) {
  // Only these statements can see this randomly generated receipt claim.
  const claim = crypto.randomUUID()
  const gate = `EXISTS (SELECT 1 FROM interaction_receipts WHERE claim = '${claim}')`
  const [receipt, ...writes] = await db.batch([
    statement(db, 'INSERT OR IGNORE INTO interaction_receipts VALUES (?, ?, ?)', interactionId, claim, now),
    ...queries(gate),
  ])
  if (!receipt.meta.changes) return null
  return writes.map(write => write.meta.changes)
}

export const acceptsBallots = "status = 'open' AND deadline > ?"
export const cancellable = `status <> 'cancelled' AND CASE WHEN status = 'confirmed' THEN starts_at + duration * 60
  ELSE (SELECT max(starts_at) FROM slots WHERE session_id = sessions.id) END > ?`

function nameKey(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

type NominationMetadata = Partial<GameTags & Pick<Game, 'rawg_id' | 'image' | 'game_details' | 'nominated_by'>>

export function nomination(
  db: D1Database, id: string, name: string, at: number, gate: string,
  metadata?: NominationMetadata,
) {
  return statement(db, `
    INSERT INTO games (session_id, name, name_key, rawg_id, image, platforms, crossplay, min_players, max_players, game_details, nominated_by)
    SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM sessions WHERE id = ? AND ${acceptsBallots} AND ${gate}
    AND (SELECT count(*) FROM games WHERE session_id = sessions.id) < 24
    ON CONFLICT DO NOTHING
  `, name, nameKey(name), metadata?.rawg_id ?? null, metadata?.image ?? null, metadata?.platforms ?? '[]',
  metadata?.crossplay ?? null, metadata?.min_players ?? null, metadata?.max_players ?? null,
  metadata?.game_details ?? '{}', metadata?.nominated_by ?? null, id, at)
}

export function addSlot(db: D1Database, id: string, startsAt: number, gate: string, at: number) {
  return statement(db, `
    INSERT INTO slots (session_id, starts_at)
    SELECT id, ? FROM sessions WHERE id = ? AND ${acceptsBallots} AND deadline < ? AND ${gate}
    AND (SELECT count(*) FROM slots WHERE session_id = sessions.id) < 10
    ON CONFLICT DO NOTHING
  `, startsAt, id, at, startsAt)
}

export function vote(db: D1Database, id: string, user: string, game: number | null, at: number, gate: string) {
  if (game === null) return statement(db, `
    DELETE FROM votes WHERE session_id = ? AND user_id = ? AND ${gate}
    AND EXISTS (SELECT 1 FROM sessions WHERE id = votes.session_id AND ${acceptsBallots})
  `, id, user, at)
  return statement(db, `
    INSERT INTO votes SELECT s.id, ?, g.id FROM sessions s JOIN games g ON g.session_id = s.id
    WHERE s.id = ? AND g.id = ? AND ${acceptsBallots} AND ${gate}
    ON CONFLICT(session_id, user_id) DO UPDATE SET game_id = excluded.game_id
  `, user, id, game, at)
}

export function availability(db: D1Database, id: string, user: string, selected: number[], at: number, gate: string) {
  const values = JSON.stringify(selected)
  const valid = `
    ${gate} AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND ${acceptsBallots})
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) j
      WHERE NOT EXISTS (SELECT 1 FROM slots t WHERE t.session_id = ? AND t.starts_at = j.value)
    )
  `
  return [
    statement(db, `DELETE FROM availability WHERE session_id = ? AND user_id = ? AND ${valid}`,
      id, user, id, at, values, id),
    statement(db, `
      INSERT INTO availability (session_id, user_id, starts_at)
      SELECT ?, ?, j.value FROM json_each(?) j WHERE ${valid}
    `, id, user, values, id, at, values, id),
  ]
}

export function manualSession(
  db: D1Database, settings: Guild, id: string, organizer: string, title: string, description: string,
  starts: number[], deadline: number, capacity: number | null, at: number, gate: string,
  { prior, game }: { prior?: { session: Session; game: Game }; game?: NominationMetadata } = {},
) {
  return [
    statement(db, `
      INSERT INTO sessions (id, guild_id, channel_id, voice_id, organizer_id, title, description,
        timezone, created_at, deadline, duration, reminder, minimum, capacity)
      SELECT ?, id, channel_id, CASE WHEN ? THEN ? ELSE voice_id END, ?, ?, ?, coalesce(?, timezone), ?, ?,
        coalesce(?, duration), coalesce(?, reminder), minimum, ?
      FROM guilds WHERE id = ? AND channel_id = ? AND timezone = ? AND ${gate}
    `, id, Number(Boolean(prior)), prior?.session.voice_id ?? null, organizer, title, description, prior?.session.timezone ?? null,
      at, deadline, prior?.session.duration ?? null, prior?.session.reminder ?? null, capacity, settings.id, settings.channel_id, settings.timezone),
    nomination(db, id, title, at, gate, prior?.game ?? game),
    ...starts.map(time => addSlot(db, id, time, gate, at)),
  ]
}

export async function details(db: D1Database, item: Session) {
  const [games, slots, counts, going, queue, event, people] = await db.batch([
    statement(db, 'SELECT id, name, image, rawg_id, votes, platforms, crossplay, min_players, max_players, game_details FROM game_tally WHERE session_id = ? ORDER BY votes DESC, id', item.id),
    statement(db, 'SELECT starts_at, available FROM slot_tally WHERE session_id = ? ORDER BY starts_at', item.id),
    statement(db, `
      SELECT CASE WHEN needs_reconfirm = 1 THEN 'reconfirm' ELSE response END AS status, count(*) AS total
      FROM rsvps WHERE session_id = ? GROUP BY status
    `, item.id),
    statement(db, "SELECT user_id FROM rsvps WHERE session_id = ? AND response = 'going' AND needs_reconfirm = 0 ORDER BY user_id LIMIT 20", item.id),
    statement(db, 'SELECT count(*) AS total FROM waitlist WHERE session_id = ?', item.id),
    statement(db, 'SELECT event_id FROM discord_events WHERE session_id = ?', item.id),
    statement(db, `
      SELECT (SELECT count(*) FROM votes WHERE session_id = ?) AS voters,
        (SELECT count(DISTINCT user_id) FROM availability WHERE session_id = ?) AS available
    `, item.id, item.id),
  ])
  const rsvps = { going: 0, maybe: 0, declined: 0, reconfirm: 0 }
  for (const row of counts.results as { status: RSVP | 'reconfirm'; total: number }[]) rsvps[row.status] = row.total
  return {
    item,
    games: games.results as unknown as Game[],
    slots: slots.results as unknown as Slot[],
    going: (going.results as { user_id: string }[]).map(row => row.user_id),
    rsvps,
    waiting: (queue.results[0] as { total: number } | undefined)?.total ?? 0,
    eventId: (event.results[0] as { event_id: string | null } | undefined)?.event_id ?? null,
    ...(people.results[0] as { voters: number; available: number }),
  }
}

export type Details = Awaited<ReturnType<typeof details>>

export function recommend(data: Details, now: number) {
  const game = data.games.find(game => game.votes > 0)
  const slot = data.slots.filter(slot => slot.available > 0 && slot.starts_at > now)
    .sort((a, b) => b.available - a.available || a.starts_at - b.starts_at)[0]
  return { game, slot }
}

// SQL resolves the same game and slot ordering as the live display, within the
// statement that closes voting. A late vote cannot slip between tally and lock.
export function close(db: D1Database, id: string, at: number, gate: string, scheduled: boolean) {
  return statement(db, `
    WITH tally AS (
      SELECT
        (SELECT id FROM game_tally WHERE session_id = ? AND votes > 0 ORDER BY votes DESC, id LIMIT 1) AS game,
        (SELECT starts_at FROM slot_tally WHERE session_id = ? AND available > 0 AND starts_at > ?
          ORDER BY available DESC, starts_at LIMIT 1) AS time,
        (SELECT max(available) FROM slot_tally WHERE session_id = ? AND starts_at > ?) AS supporters
    )
    UPDATE sessions SET
      game_id = tally.game, starts_at = tally.time, decided_at = ?,
      status = CASE WHEN ? AND auto_confirm AND tally.game IS NOT NULL AND tally.time IS NOT NULL
                    AND tally.supporters >= minimum AND (capacity IS NULL OR capacity >= minimum) THEN 'confirmed' ELSE 'closed' END
    FROM tally WHERE id = ? AND status = 'open' AND (? = 0 OR deadline <= ?) AND ${gate}
  `, id, id, at, id, at, at, Number(scheduled), id, Number(scheduled), at)
}

export function confirm(db: D1Database, id: string, game: number | null, slot: number | null, at: number, gate: string) {
  return statement(db, `
    WITH pick AS (
      SELECT
        coalesce(?, CASE WHEN status = 'closed' THEN game_id ELSE (
          SELECT id FROM game_tally WHERE session_id = sessions.id AND votes > 0 ORDER BY votes DESC, id LIMIT 1
        ) END) AS game,
        coalesce(?, CASE WHEN status = 'closed' THEN starts_at ELSE (
          SELECT starts_at FROM slot_tally WHERE session_id = sessions.id AND available > 0 AND starts_at > ?
          ORDER BY available DESC, starts_at LIMIT 1
        ) END) AS time
      FROM sessions WHERE id = ?
    )
    UPDATE sessions SET game_id = pick.game, starts_at = pick.time, status = 'confirmed', decided_at = ?
    FROM pick WHERE id = ? AND status IN ('open','closed') AND pick.time > ? AND ${gate}
    AND EXISTS (SELECT 1 FROM games WHERE session_id = sessions.id AND id = pick.game)
    AND EXISTS (SELECT 1 FROM slots WHERE session_id = sessions.id AND starts_at = pick.time)
  `, game, slot, at, id, at, id, at)
}

export function checkedLabel(value: string, length: number) {
  const text = value.trim()
  // eslint-disable-next-line no-control-regex -- Discord fields must stay on one line.
  if (!text || text.length > length || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new InputError(`Enter a single line of 1–${length} characters.`)
  }
  return text
}
