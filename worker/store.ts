import { InputError, type Game, type Guild, type Param, type RSVP, type Session, type Slot } from './types.ts'

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

export function nameKey(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function nomination(db: D1Database, id: string, name: string, at: number, gate: string, rawgId: number | null = null, image: string | null = null) {
  return statement(db, `
    INSERT INTO games (session_id, name, name_key, rawg_id, image)
    SELECT id, ?, ?, ?, ? FROM sessions WHERE id = ? AND ${acceptsBallots} AND ${gate}
    AND (SELECT count(*) FROM games WHERE session_id = sessions.id) < 24
    ON CONFLICT DO NOTHING
  `, name, nameKey(name), rawgId, image, id, at)
}

export function addSlot(db: D1Database, id: string, startsAt: number, gate: string, at = 0) {
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

export function attendance(db: D1Database, id: string, user: string, response: RSVP, now: number, gate: string) {
  return statement(db, `
    INSERT INTO rsvps (session_id, user_id, response)
    SELECT s.id, ?, ? FROM sessions s
    WHERE s.id = ? AND s.status <> 'cancelled' AND ${gate}
    AND CASE WHEN s.status = 'confirmed' THEN s.starts_at + s.duration * 60
      ELSE (SELECT max(starts_at) FROM slots WHERE session_id = s.id) END > ?
    AND (? <> 'going' OR s.capacity IS NULL OR s.capacity > (
      SELECT count(*) FROM rsvps r WHERE r.session_id = s.id AND r.response = 'going' AND r.user_id <> ?
    ))
    ON CONFLICT(session_id, user_id) DO UPDATE SET response = excluded.response
  `, user, response, id, now, response, user)
}

export function manualSession(
  db: D1Database, settings: Guild, id: string, organizer: string, title: string, description: string,
  starts: number[], deadline: number, capacity: number | null, at: number, gate: string,
) {
  return [
    statement(db, `
      INSERT INTO sessions (id, guild_id, channel_id, voice_id, organizer_id, title, description,
        timezone, created_at, deadline, duration, reminder, minimum, capacity)
      SELECT ?, id, channel_id, voice_id, ?, ?, ?, timezone, ?, ?, duration, reminder, minimum, ?
      FROM guilds WHERE id = ? AND ${gate}
    `, id, organizer, title, description, at, deadline, capacity, settings.id),
    nomination(db, id, title, at, gate),
    ...starts.map(time => addSlot(db, id, time, gate, at)),
  ]
}

export async function details(db: D1Database, item: Session) {
  const [games, slots, counts, going, board] = await db.batch([
    statement(db, 'SELECT id, name, image, rawg_id, votes FROM game_tally WHERE session_id = ? ORDER BY votes DESC, id', item.id),
    statement(db, 'SELECT starts_at, available FROM slot_tally WHERE session_id = ? ORDER BY starts_at', item.id),
    statement(db, 'SELECT response, count(*) AS total FROM rsvps WHERE session_id = ? GROUP BY response', item.id),
    statement(db, "SELECT user_id FROM rsvps WHERE session_id = ? AND response = 'going' ORDER BY user_id LIMIT 20", item.id),
    statement(db, `
      SELECT message_id FROM deliveries WHERE session_id = ? AND state = 'sent' AND kind <> 'reminder'
      ORDER BY id DESC LIMIT 1
    `, item.id),
  ])
  const rsvps = { going: 0, maybe: 0, declined: 0 }
  for (const row of counts.results as { response: RSVP; total: number }[]) rsvps[row.response] = row.total
  return {
    item,
    games: games.results as unknown as Game[],
    slots: slots.results as unknown as Slot[],
    going: (going.results as { user_id: string }[]).map(row => row.user_id),
    rsvps,
    messageId: (board.results[0] as { message_id: string } | undefined)?.message_id ?? null,
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
