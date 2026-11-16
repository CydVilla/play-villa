import { rows } from './store.ts'
import { snowflake, type Env, type Game, type Session, type Slot } from './types.ts'

type PublicRow = Pick<Session, 'id' | 'title' | 'description' | 'timezone' | 'channel_id' | 'voice_id' |
  'status' | 'deadline' | 'decided_at' | 'starts_at' | 'game_id' | 'duration' | 'capacity'> & {
  games: string
  slots: string
  response_counts: string
  message_id: string | null
}

export async function publicSchedule(env: Env, request: Request, at: number) {
  const origin = request.headers.get('Origin')
  const ownOrigin = new URL(request.url).origin
  if (origin && origin !== ownOrigin && origin !== env.WEB_ORIGIN) {
    return Response.json({ error: 'Origin is not allowed.' }, { status: 403, headers: { Vary: 'Origin' } })
  }
  const headers = new Headers({ Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' })
  if (origin && origin === env.WEB_ORIGIN) headers.set('Access-Control-Allow-Origin', origin)
  const id = env.PUBLIC_GUILD_ID
  const channel = env.PUBLIC_CHANNEL_ID
  if (!snowflake(id) || !snowflake(channel) || (env.DISCORD_GUILD_ID && env.DISCORD_GUILD_ID !== id)) {
    return Response.json({ error: 'This installation has no public schedule.' }, { status: 404, headers })
  }
  const result = await rows<PublicRow>(env.DB, `
    WITH current AS (
      SELECT * FROM sessions WHERE guild_id = ? AND channel_id = ? AND (
        (status IN ('open','closed') AND (SELECT max(starts_at) FROM slots WHERE session_id = sessions.id) > ?)
        OR (status = 'confirmed' AND starts_at + duration * 60 > ?)
      ) ORDER BY created_at DESC LIMIT 12
    ), history AS (
      SELECT * FROM sessions WHERE guild_id = ? AND channel_id = ? AND status = 'confirmed' AND starts_at + duration * 60 <= ?
      ORDER BY starts_at DESC LIMIT 20
    )
    SELECT id, title, description, timezone, channel_id, voice_id, status, deadline, decided_at,
      starts_at, game_id, duration, capacity,
      (SELECT json_group_array(json_object('id', id, 'name', name, 'image', image, 'rawg_id', rawg_id, 'votes', votes))
        FROM (SELECT * FROM game_tally WHERE session_id = s.id ORDER BY votes DESC, id)) AS games,
      (SELECT json_group_array(json_object('starts_at', starts_at, 'available', available))
        FROM (SELECT * FROM slot_tally WHERE session_id = s.id ORDER BY starts_at)) AS slots,
      (SELECT json_group_object(response, total) FROM (
        SELECT response, count(*) AS total FROM rsvps WHERE session_id = s.id GROUP BY response
      )) AS response_counts,
      (SELECT message_id FROM deliveries WHERE session_id = s.id AND state = 'sent'
        AND kind <> 'reminder' ORDER BY id DESC LIMIT 1) AS message_id
    FROM (SELECT * FROM current UNION ALL SELECT * FROM history) s
  `, id, channel, at, at, id, channel, at)
  headers.set('Cache-Control', 'public, max-age=15')
  return Response.json({
    sessions: result.map(item => ({
      ...item,
      status: item.status === 'open' && item.deadline <= at ? 'closed' : item.status,
      guild_id: id,
      games: JSON.parse(item.games) as Game[],
      slots: JSON.parse(item.slots) as Slot[],
      response_counts: { going: 0, maybe: 0, declined: 0, ...JSON.parse(item.response_counts) },
      past: item.status === 'confirmed' && item.starts_at! + item.duration * 60 <= at,
    })),
  }, { headers })
}
