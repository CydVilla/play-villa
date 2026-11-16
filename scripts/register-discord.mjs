import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { gameNightCommand } from '../worker/commands.ts'
import { snowflake } from '../worker/types.ts'

if (existsSync('.dev.vars')) loadEnvFile('.dev.vars')
const { DISCORD_APPLICATION_ID: app, DISCORD_GUILD_ID: guild, DISCORD_BOT_TOKEN: token } = process.env
const global = process.argv.includes('--global')
if (!snowflake(app) || !token || (!global && !snowflake(guild)) || (global && guild)) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN. Set DISCORD_GUILD_ID for a guild install, or leave it empty and pass --global.')
  process.exit(1)
}
const scope = global ? '' : `/guilds/${guild}`
const { integration_types: integrationTypes, contexts, ...guildCommand } = gameNightCommand
const command = global ? { ...guildCommand, integration_types: integrationTypes, contexts } : guildCommand
try {
  // POST upserts this command by name and leaves other applications' and
  // this application's unrelated commands alone.
  const response = await fetch(`https://discord.com/api/v10/applications/${app}${scope}/commands`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    const delay = response.headers.get('Retry-After')
    console.error(`Command registration failed (HTTP ${response.status}).${delay ? ` Retry after ${delay} seconds.` : ''}`)
    process.exitCode = 1
  } else {
    console.log(`Registered /gamenight ${global ? 'globally' : 'in the configured guild'}.`)
  }
} catch {
  console.error('Could not reach the Discord application commands API.')
  process.exitCode = 1
}
