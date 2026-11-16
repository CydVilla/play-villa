import { discord, retrySeconds } from './discord-api.ts'
import { board, spotOffer } from './presentation.ts'
import { details, rows, statement } from './store.ts'
import { nowSeconds, snowflake, type Delivery, type Env, type Session } from './types.ts'

async function finish(
  env: Env, delivery: Delivery, state: Delivery['state'], messageId: string | null, error: string | null,
  nextAt = 0, attemptedAt = delivery.attempted_at,
) {
  await statement(env.DB, `
    UPDATE deliveries SET state = ?, message_id = ?, error = ?, next_at = ?, attempted_at = ?, lease_until = 0, claim = NULL
    WHERE id = ? AND claim = ?
  `, state, messageId, error, nextAt, attemptedAt, delivery.id, delivery.claim).run()
}

function shouldSend(delivery: Delivery, item: Session, at: number) {
  if (delivery.revision !== item.revision) return false
  if (delivery.kind === 'reminder' || delivery.kind === 'rescheduled' || delivery.kind === 'offer') return item.status === 'confirmed' && item.starts_at! > at
  return delivery.kind === item.status
}

async function reconcile(env: Env, delivery: Delivery, item: Session, at: number) {
  // Even after Discord's nonce window expires, the message footer identifies
  // our own send. A crash before recording a POST is treated as ambiguous.
  const boundary = (BigInt(delivery.attempted_at! * 1000 - 1420070400000) << 22n).toString()
  let delay = 60
  try {
    const response = await discord(`/channels/${item.channel_id}/messages?after=${boundary}&limit=100`, {
      token: env.DISCORD_BOT_TOKEN,
    })
    if (response.ok) {
      const messages = await response.json<{ id: string; author?: { id: string }; embeds?: { footer?: { text: string } }[] }[]>()
      const existing = messages.find(message => message.author?.id === env.DISCORD_APPLICATION_ID &&
        message.embeds?.some(embed => embed.footer?.text === `Play Villa · ${delivery.id}`))
      if (existing && snowflake(existing.id)) {
        return finish(env, delivery, 'sent', existing.id, null)
      }
    }
    if (response.status === 429) delay = await retrySeconds(response)
  } catch {
    // Network failures during reconciliation are also recoverable on the next tick.
  }
  if (at - delivery.attempted_at! >= 1800) {
    return finish(env, delivery, 'blocked', null, 'Discord may have accepted this message. Check channel history.')
  }
  return finish(env, delivery, 'pending', null, 'Checking Discord for an earlier send.', at + delay)
}

async function deliver(env: Env, id: number, at: number) {
  const delivery = await statement(env.DB, `
    UPDATE deliveries SET lease_until = ?, claim = ?, attempts = attempts + 1
    WHERE id = ? AND state = 'pending' AND next_at <= ? AND lease_until <= ?
    RETURNING *
  `, at + 45, crypto.randomUUID(), id, at, at).first<Delivery>()
  if (!delivery) return
  const item = await statement(env.DB, 'SELECT * FROM sessions WHERE id = ?', delivery.session_id).first<Session>()
  if (!item) return finish(env, delivery, 'skipped', null, null)
  if (delivery.attempted_at) return reconcile(env, delivery, item, at)
  if (!shouldSend(delivery, item, at)) return finish(env, delivery, 'skipped', null, null)

  const offer = delivery.kind === 'offer' ? await statement(env.DB, `
    SELECT user_id, offered_until FROM waitlist WHERE id = ? AND session_id = ? AND offered_until > ?
  `, delivery.occurrence, item.id, at).first<{ user_id: string; offered_until: number }>() : null
  if (delivery.kind === 'offer' && (!offer || !snowflake(offer.user_id))) {
    return finish(env, delivery, 'skipped', null, null)
  }
  const message = offer ? spotOffer(item, delivery, offer) : board(await details(env.DB, item), at, delivery)
  const attemptedAt = nowSeconds()
  const marked = await statement(env.DB, `
    UPDATE deliveries SET attempted_at = ? WHERE id = ? AND claim = ? AND lease_until > ?
    AND EXISTS (
      SELECT 1 FROM sessions s WHERE s.id = deliveries.session_id AND s.revision = deliveries.revision
      AND s.status = ?
    )
    AND (kind <> 'offer' OR EXISTS (
      SELECT 1 FROM waitlist WHERE id = deliveries.occurrence AND session_id = deliveries.session_id AND offered_until > ?
    ))
  `, attemptedAt, id, delivery.claim, attemptedAt, item.status, attemptedAt).run()
  if (!marked.meta.changes) return
  delivery.attempted_at = attemptedAt

  let response: Response
  try {
    response = await discord(`/channels/${item.channel_id}/messages`, {
      token: env.DISCORD_BOT_TOKEN,
      method: 'POST',
      pingUser: offer?.user_id,
      body: { ...message, flags: offer ? 0 : 4096, nonce: `pv-${delivery.id}`, enforce_nonce: true },
    })
  } catch {
    return finish(env, delivery, 'pending', null, 'Discord did not confirm delivery.', at + 60)
  }
  if (response.status === 429) {
    return finish(env, delivery, 'pending', null, 'Discord rate limit.', at + await retrySeconds(response), null)
  }
  if (response.status >= 500) {
    return finish(env, delivery, 'pending', null, 'Discord returned a server error.', at + 60)
  }
  if (!response.ok) {
    // Keep permission/configuration failures recoverable once the operator fixes them.
    const delay = Math.min(3600, 30 * 2 ** Math.min(delivery.attempts, 7))
    const state = response.status === 400 ? 'blocked' : 'pending'
    return finish(env, delivery, state, null, `Discord HTTP ${response.status}.`, at + delay, null)
  }
  const created = await response.json<{ id?: string }>()
  if (snowflake(created.id)) return finish(env, delivery, 'sent', created.id, null)
  return finish(env, delivery, 'pending', null, 'Discord response did not include a message ID.', at + 60)
}

export async function deliverPending(env: Env, at: number, sessionId: string | null = null) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) return
  const filter = sessionId ? 'AND session_id = ?' : ''
  const ids = await rows<{ id: number }>(env.DB, `
    SELECT id FROM deliveries WHERE state = 'pending' AND next_at <= ? AND lease_until <= ? ${filter}
    ORDER BY next_at, id LIMIT 3
  `, at, at, ...(sessionId ? [sessionId] : []))
  for (const { id } of ids) {
    try {
      await deliver(env, id, at)
    } catch {
      console.error('Discord delivery will be checked by a later scheduler run', id)
    }
  }
}
