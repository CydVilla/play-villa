import { escapeText } from './discord-api.ts'
import { InputError, type Game } from './types.ts'

const platformNames = new Map([
  ['pc', 'PC'], ['xbox', 'Xbox'], ['playstation', 'PlayStation'], ['switch', 'Switch'], ['mobile', 'Mobile'],
])

export function parsePlatforms(input: string) {
  if (!input) return []
  const names = input.split(',').map(name => name.trim().toLowerCase())
  if (!names.every(name => platformNames.has(name))) {
    throw new InputError('Use comma-separated platform names from PC, Xbox, PlayStation, Switch, and Mobile.')
  }
  return [...new Set(names)]
}

export function partyLabel(game: Game) {
  const platforms = (JSON.parse(game.platforms) as string[]).map(name => platformNames.get(name)).join(', ')
  const size = game.max_players !== null ? `${game.min_players ?? 1}–${game.max_players} players`
    : game.min_players !== null ? `${game.min_players}+ players` : ''
  return [platforms, game.crossplay === 1 ? 'crossplay' : game.crossplay === 0 ? 'no crossplay' : '', size]
    .filter(Boolean).join(' · ')
}

export function shortlist(games: Game[], platforms: string[], crossplay: boolean, players: number | null, surprise: boolean) {
  const eligible = games.filter(game =>
    platforms.every(name => (JSON.parse(game.platforms) as string[]).includes(name)) &&
    (!crossplay || game.crossplay === 1) &&
    (players === null || (game.max_players !== null && players >= (game.min_players ?? 1) && players <= game.max_players)),
  )
  if (!eligible.length) return 'No nominated games match. Ask an organizer to tag games or loosen your filters.'
  const describe = (game: Game) => {
    const tags = partyLabel(game)
    return `**${escapeText(game.name)}**${tags ? ` · ${tags}` : ''}`
  }
  if (surprise) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
    return `🎲 Surprise pick · ${describe(eligible[Math.floor(random * eligible.length)])}`
  }
  return eligible.map(describe).join('\n').slice(0, 1900)
}
