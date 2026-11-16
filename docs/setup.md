# Self-host Play Villa

## Cloudflare Worker and D1

1. Install Node.js 22.12 or later and run `npm ci`. Sign in to Cloudflare with `npx wrangler login`. Create a D1 database on the Free plan in the Cloudflare dashboard, then note its name and UUID.
2. Copy `wrangler.toml` to `wrangler.local.toml`. Use your own Worker name, database name, and database UUID in that ignored file. The committed file uses a placeholder UUID for local emulation.
3. Create a new Discord application in the [Discord Developer Portal](https://discord.com/developers/applications). Enable Guild Install and copy the application ID and public key from **General Information**. Create or obtain the bot token in the **Bot** settings. Treat the token as a secret. An application has one interactions endpoint, so a new application is the simplest way to keep an existing bot running in its original server. [Discord app setup](https://docs.discord.com/developers/quick-start/getting-started)
4. Add an appropriate `[vars]` block to `wrangler.local.toml`. Replace every example value with your own before deployment. Omit the two public variables for a Discord-only install. Add `WEB_ORIGIN` only for a separately hosted companion such as GitHub Pages.

   ```toml
   [vars]
   DISCORD_APPLICATION_ID = "YOUR_APPLICATION_ID"
   DISCORD_PUBLIC_KEY = "YOUR_APPLICATION_PUBLIC_KEY"
   DISCORD_GUILD_ID = "YOUR_SERVER_ID"
   # Optional explicit public schedule opt-in for one server and text channel.
   # PUBLIC_GUILD_ID = "YOUR_SERVER_ID"
   # PUBLIC_CHANNEL_ID = "YOUR_ANNOUNCEMENT_CHANNEL_ID"
   # WEB_ORIGIN = "https://YOUR_ACCOUNT.github.io"
   ```

5. Optionally copy `.env.example` to `.env.local` to set public site branding, a community invite, donation link, or affiliate tag. Only set values you want site visitors to see. Only add an invite if you want visitors to be able to join from the site.
6. Build the site, apply the schema to the new database, and deploy the Worker.

   ```sh
   npm run build
   npx wrangler d1 migrations apply DB --remote --config wrangler.local.toml
   npx wrangler deploy --config wrangler.local.toml
   npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.local.toml
   ```

7. If you want optional game search, add a RAWG API key with `npx wrangler secret put RAWG_API_KEY --config wrangler.local.toml`. RAWG attribution is built in. Check the [RAWG API terms](https://rawg.io/tos_api) before enabling it, especially on a monetized deployment.
8. Open the Worker URL plus `/health` and check for `{"ok":true}`. If publishing a public schedule, confirm both the guild and text channel were intended for publication. The schedule includes titles, descriptions, nominations, totals and Discord channel links. Keep private plans in another channel or leave the schedule disabled.

## Install in Discord

1. In the Developer Portal, set **Interactions Endpoint URL** to `https://YOUR_WORKER_HOST/discord/interactions`. Saving checks the app’s public key by sending a signed ping. [Interaction setup and signatures](https://docs.discord.com/developers/interactions/receiving-and-responding)
2. Install the bot in your intended server with OAuth2 scopes `bot` and `applications.commands`. Grant **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in the announcement channel. The combined permissions value is `84992`. The bot needs neither Administrator nor any privileged Gateway intents. Ordinary members need **Use Application Commands**. [Discord permissions](https://docs.discord.com/developers/topics/permissions)
3. Copy `.dev.vars.example` to the ignored `.dev.vars`. Set `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, and `DISCORD_BOT_TOKEN` there for the registration script. Run `npm run discord:register`. This uses guild registration for fast setup and upserts only Play Villa’s command. For a multi-server install, omit `DISCORD_GUILD_ID` in both configurations and run `npm run discord:register -- --global`. Use guild registration while testing.
4. Run `/gamenight configure` as a server manager. Choose the announcement text channel, and optionally set an organizer role, voice channel, automatic-confirmation quorum, duration and reminder offset. Subsequent polls use these defaults. Settings and votes are isolated by guild. A session stays in its original announcement channel.
5. Run `/gamenight weekly` with `open: mon 18:00`, `close: thu 18:00`, and `slots: fri 20:00, sat 20:00` to try a recurring schedule. Set `auto` to true to enable quorum-based confirmation. All weekly times use the configured guild time zone. Use `enabled: false` to pause new polls.

## Optional GitHub Pages companion

Build with `VITE_API_URL` set to the deployed Worker origin. The build uses relative asset paths and can be published from `dist/` using a Pages artifact or a dedicated Pages branch. Set `WEB_ORIGIN` in the Worker to the exact Pages origin, without a path or trailing slash, and redeploy the Worker. Keep `PUBLIC_GUILD_ID` and `PUBLIC_CHANNEL_ID` enabled for the published schedule. The same-origin Worker-hosted site also functions independently when built with `VITE_API_URL` empty.

## Verify a fresh installation with two Discord accounts

1. Configure a test text channel and create a session with two future slots. Confirm that the channel receives one board and the site shows the same session if it is published.
2. As a member, nominate a game, vote, switch votes, retract, and vote again. Select both slots and change the selection to one. Cycle through RSVP statuses and check **View details**.
3. Confirm the member cannot cancel or confirm. As the organizer, close voting, inspect the recommendations, and confirm with or without an override. Verify one confirmation post, the voice link if set, and the correct start and end in the calendar export.
4. Change an RSVP after confirmation. Set up a short test window for the cron, confirm one round opens and one reminder is sent, then cancel a test session and verify its reminder no longer sends. Use `/gamenight delivery-status` to diagnose delivery problems.
5. Once the new install is proven, update your site's public links wherever you currently publish them. If moving from an older client-side integration, rotate any webhook or API key previously included in the browser build.
