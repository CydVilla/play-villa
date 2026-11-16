import { statement } from './store.ts'
import { InputError, type Env } from './types.ts'

interface RawgGame {
  id: number
  name: string
  background_image?: string
}

async function request(env: Env, path: string, query?: string) {
  if (!env.RAWG_API_KEY) throw new InputError('Game search is disabled. Use a custom game name.')
  const url = new URL(`https://api.rawg.io/api/games${path}`)
  url.searchParams.set('key', env.RAWG_API_KEY)
  if (query) {
    url.searchParams.set('search', query)
    url.searchParams.set('page_size', '6')
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3500), redirect: 'error' })
    if (!response.ok) throw new Error()
    return response
  } catch {
    // Upstream errors can contain a URL with the API key.
    throw new InputError('RAWG is unavailable. Try another search later, or nominate a custom game.')
  }
}

export async function allowRawg(env: Env, guildId: string, at: number) {
  if (!env.RAWG_API_KEY) throw new InputError('Game search is disabled. Use a custom game name.')
  const result = await statement(env.DB, `
    INSERT INTO search_limits VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET next_at = excluded.next_at WHERE search_limits.next_at <= ?
  `, guildId, at + 10, at).run()
  if (!result.meta.changes) throw new InputError('Please wait ten seconds between RAWG requests in this server.')
}

function pick(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null
  const game = candidate as RawgGame
  if (!Number.isSafeInteger(game.id) || game.id < 1 || typeof game.name !== 'string' || !game.name.trim()) return null
  let image = null
  if (typeof game.background_image === 'string' && game.background_image.length < 512) {
    try {
      const url = new URL(game.background_image)
      if (url.origin === 'https://media.rawg.io' && !url.username && !url.password) image = url.href
    } catch { /* Ignore malformed upstream images. */ }
  }
  // eslint-disable-next-line no-control-regex -- Strip untrusted C0 controls.
  return { id: game.id, name: game.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100), image }
}

export async function searchRawg(env: Env, query: string) {
  if (query.length < 2) throw new InputError('Search for at least two characters.')
  const response = await request(env, '', query)
  const data = await response.json<{ results?: unknown }>().catch(() => null)
  if (!Array.isArray(data?.results)) throw new InputError('RAWG did not return search results.')
  return data.results.slice(0, 6).map(pick).filter(game => game !== null)
}

export async function rawgGame(env: Env, id: number) {
  const response = await request(env, `/${id}`)
  const game = pick(await response.json().catch(() => null))
  if (!game || game.id !== id || !game.name) throw new InputError('RAWG did not return that game.')
  return game
}
