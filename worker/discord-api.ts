import { snowflake, type Env } from './types.ts'

export type Message = {
  content?: string
  embeds?: {
    title?: string
    description?: string
    color?: number
    thumbnail?: { url: string }
    footer?: { text: string }
  }[]
  components?: Record<string, unknown>[]
}

export const apiBase = 'https://discord.com/api/v10'
export const mentions = { parse: [] }
export const timestamp = (at: number, format = 'f') => `<t:${at}:${format}>`
export const channelLink = (guild: string, channel: string, message?: string | null) =>
  `https://discord.com/channels/${guild}/${channel}${message ? `/${message}` : ''}`

export function escapeText(text: string) {
  return text.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, '\\$&')
}

export function discord(path: string, options: {
  token?: string
  method?: 'GET' | 'POST' | 'PATCH'
  body?: object
  timeout?: number
  // Only these users and roles are notified. Everything else in the message stays inert.
  ping?: { users?: string[]; roles?: string[] }
} = {}) {
  const headers = new Headers()
  if (options.token) headers.set('Authorization', `Bot ${options.token}`)
  if (options.body) headers.set('Content-Type', 'application/json')
  const users = options.ping?.users?.filter(snowflake) ?? []
  const roles = options.ping?.roles?.filter(snowflake) ?? []
  const allowed = { ...mentions, ...(users.length ? { users } : {}), ...(roles.length ? { roles } : {}) }
  return fetch(apiBase + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(path.includes('/messages') ? { ...options.body, allowed_mentions: allowed } : options.body) : undefined,
    // Workers supports manual redirects. A 3xx response stays an HTTP failure.
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeout ?? 7000),
  })
}

export async function retrySeconds(response: Response) {
  const header = Number(response.headers.get('Retry-After'))
  if (header > 0) return Math.ceil(header)
  try {
    const body = await response.json<{ retry_after?: number }>()
    if (Number(body.retry_after) > 0) return Math.ceil(Number(body.retry_after))
  } catch { /* Use a conservative default for a response without JSON. */ }
  return 60
}

export async function patchReply(env: Env, token: string, message: Message) {
  const path = `/webhooks/${env.DISCORD_APPLICATION_ID}/${encodeURIComponent(token)}/messages/@original`
  const body = { content: '', components: [], embeds: [], ...message }
  let response = await discord(path, { method: 'PATCH', body })
  // Discord may still be registering the deferred response.
  const delay = response.status === 404 ? 0.35 : response.status === 429 ? await retrySeconds(response) : null
  if (delay !== null && delay <= 3) {
    await new Promise(resolve => setTimeout(resolve, delay * 1000))
    response = await discord(path, { method: 'PATCH', body })
  }
  if (!response.ok) console.error('Discord response update failed', response.status)
}
