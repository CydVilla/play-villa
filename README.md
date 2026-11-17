# Play Villa

Play Villa is a self-hosted Discord bot for picking a game and finding a time to play together. An organizer creates a game night, members vote on games and mark their available times, and the bot recommends a game and time. Confirmed nights get a Discord announcement and an optional reminder. Full nights can hold a seat for the next person on the waitlist. [How to play](#run-your-first-game-night)

The bot runs on Cloudflare Workers and stores each server’s settings, polls, and RSVPs in a D1 database. One Worker can also host the optional read-only companion site, with upcoming nights, vote totals, game details, past winners, and calendar exports. A small community can run within the Workers and D1 Free quotas. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

## Set up your Discord server

You’ll need a Cloudflare account, [Node.js 22.12 or later](https://nodejs.org/en/download), and **Manage Server** permission in a Discord server. Each installation creates its own Discord app, Worker, and database. If you’re using an agent, give it the [agent setup guide](docs/agent-setup.md).

### 1. Download Play Villa

[Download the ZIP](https://github.com/CydVilla/play-villa/archive/refs/heads/main.zip), then unzip it. You can also fork or clone the repo. Open a terminal in the folder containing `package.json` and install the dependencies.

```sh
npm ci
```

### 2. Create a Discord application

1. Open the Discord Developer Portal and choose **New Application**. Name it whatever you want members to see and create it. Under **General Information**, copy the **Application ID** and **Public Key** for the next step. [Discord Developer Portal](https://discord.com/developers/applications)
2. In Discord, open **User Settings → Advanced** and turn on **Developer Mode**. Right-click your server icon and choose **Copy Server ID**. [Discord’s guide to IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)
3. On the app’s **Installation** page, enable **Guild Install** and select **Discord Provided Link**. Under the default **Guild Install** settings, add the `bot` and `applications.commands` scopes. Select **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History**. Save the page. [Discord’s app installation guide](https://docs.discord.com/developers/quick-start/getting-started#setting-up-an-application)

### 3. Deploy to Cloudflare

Sign in and create a database. Use a unique database name if you already have one called `play-villa-db`. Copy the database name and ID printed by Wrangler.

```sh
npx wrangler login
npx wrangler d1 create play-villa-db --update-config=false
cp wrangler.toml wrangler.local.toml
```

Open the new `wrangler.local.toml` in a text editor. At the top, choose a unique Worker `name`. Under `[[d1_databases]]`, replace `database_name` and `database_id` with the values Wrangler printed. Keep `binding = "DB"`. Append this block and replace the three placeholders with the values you copied from Discord.

```toml
[vars]
DISCORD_APPLICATION_ID = "YOUR_APPLICATION_ID"
DISCORD_PUBLIC_KEY = "YOUR_APPLICATION_PUBLIC_KEY"
DISCORD_GUILD_ID = "YOUR_SERVER_ID"
```

Build the site, create the tables in your D1 database, and deploy the Worker. Copy the HTTPS Worker URL printed by the final command. Add `/health` to it in your browser. You should see `{"ok":true}`.

```sh
npm run build
npx wrangler d1 migrations apply DB --remote --config wrangler.local.toml
npx wrangler deploy --config wrangler.local.toml
```

### 4. Connect and install the bot

1. Back in **General Information** in the Discord Developer Portal, paste your Worker URL plus `/discord/interactions` into **Interactions Endpoint URL**. Save it. Discord checks the public key by sending a signed test request. [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
2. Open the install link from the app’s **Installation** page. Choose **Add to Server**, pick the server from step 2, and authorize it.
3. On the app’s **Bot** page, generate or reset the token for **this new app**. Keep it handy while you finish the next step. It is a password for your bot. [Discord’s guide to bot tokens](https://docs.discord.com/developers/quick-start/getting-started)

### 5. Store the token and register the command

Run this command and paste the token at the Wrangler prompt. Cloudflare stores it as an encrypted Worker secret. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```sh
npx wrangler secret put DISCORD_BOT_TOKEN --config wrangler.local.toml
```

Copy `.dev.vars.example` to `.dev.vars` in the project folder. Both `.dev.vars` and `wrangler.local.toml` are ignored by Git.

```sh
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` in a local text editor. Fill in `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, and `DISCORD_BOT_TOKEN`. Save it, then register the command.

```sh
npm run discord:register
```

When the script says it registered `/gamenight`, erase the token value from the local `.dev.vars` copy. The live bot uses the Worker secret.

### 6. Pick a channel and try a poll

In your server, select `/gamenight configure` from Discord’s slash-command picker. Set **channel** to your game-night text channel and **timezone** to a city-based time zone such as `America/New_York`. A server manager can also set an organizer role, voice channel, minimum attendance, and reminder timing.

In that channel, use `/gamenight create` for a clearly labeled test round. Enter a game name, then pick a future **date** and **time**. Review the private preview and choose how to publish. Try **Vote** and **Available times** on the board. Then use `/gamenight cancel` and select the test round. [Two-account verification](docs/setup.md#verify-a-fresh-installation-with-two-discord-accounts) · [Troubleshooting](docs/setup.md#troubleshooting)

## Run your first game night

| Who | Action |
| --- | --- |
| Organizer | Use `/gamenight create` with a game name, then choose **date** and **time**. Type part of a date to find it, or enter a time like `7:30 PM` in the server time zone. Submit to see a private preview, then choose **Publish with RAWG match** or **Publish as typed**. RAWG verification is on by default; set **verify_game** to false to skip the lookup and review the typed title. |
| Members | Use `/gamenight nominate` with **session** and **game** to add any game by name. Add **notes** for details such as where to get it. If RAWG is enabled, use `/gamenight search` with just a game name when one ballot is open, then pick a result. Choose **session** when several ballots are open. Use **Vote** on the board to vote, switch, or retract. |
| Members | Use **Available times** to mark every slot you can make. Match the numbers in the dropdown to the times shown in your local time. Suggest a new time with `/gamenight propose-time`. Use **Going**, **Maybe**, or **Can’t attend** to RSVP. |
| Organizer | Check **View details** for the current counts. Close voting with `/gamenight close` or wait for the deadline. Use `/gamenight confirm` to accept the recommended game and time or choose your own from the poll. |
| Members | If a confirmed night is full, select **Going** to join its waitlist. Play Villa tags you in the channel when it offers you a seat. Select **Going** again within 30 minutes or before the game starts, whichever comes first. Select **Maybe** or **Can’t attend** to leave the waitlist. |
| Organizer | Move a confirmed night before it starts with `/gamenight reschedule`. The new board asks attendees to RSVP again, clears the old waitlist, and updates the companion’s calendar export. |
| Organizer | Use `/gamenight rematch` on a completed night. Pick a new time to open a fresh poll with the prior game, voice channel, duration, and player cap. |
| Members | Add platform, crossplay, and player-count tags when nominating. An organizer can update them with `/gamenight tag`. Use `/gamenight shortlist` to filter the nominees, or turn on **surprise** to draw one. The board’s **🎲 Surprise me** button draws from the whole poll. |
| Server manager | Run `/gamenight weekly` to see whether recurring polls are on. To start them, provide **open**, **close**, and **slots**. For example, use `mon 18:00`, `thu 18:00`, and `fri 20:00, sat 20:00` in those fields. Set **auto** to true if you want the bot to confirm a round when it has a winning vote and enough availability. |

The recommended game has the most votes. The recommended slot has the most available players who can attend. Ties favor the earliest nomination or earliest start. The opening board shows saved details for the first nominee, and **View details** shows details for the leading game once votes are in. A confirmation includes the picked game’s details, the time, and a voice-channel link when configured. RAWG can supply platforms, genres, release date, and publisher. Game tags are supplied by members. A platform filter requires every selected platform and a size filter uses the stated player range. The surprise draw leaves votes unchanged. [Scheduling rules](docs/architecture.md#scheduling-and-ballots)

## Optional setup

- [Add confirmed nights to Discord Events](docs/setup.md#enable-discord-events) when you want them on the server’s Events tab.
- [Upgrade an existing installation](docs/setup.md#upgrade-an-existing-installation) to add the new commands and database changes.
- [Publish the companion site](docs/setup.md#publish-the-companion-site) to share a read-only schedule for one channel. The bot works with a private Discord schedule by default.
- [Enable RAWG search](docs/setup.md#enable-game-search) to find games and save their details with nominations.
- [Host the companion on GitHub Pages](docs/setup.md#optional-github-pages-companion) if you already use Pages.
- [Set up with an agent](docs/agent-setup.md) for gathering settings, deployment, secret entry, and verification.

<details>
<summary>Preview the companion site</summary>

![Play Villa companion site with sample game nights](docs/companion.png)

</details>

## Develop locally

```sh
npm ci
npm run build
npm run db:local
npm run dev:worker
```

The local Worker and built site are available on port 8787. For frontend hot reload, run `npm start` separately. Vite proxies API requests to the local Worker. Use `.dev.vars.example` to see the settings the local Worker accepts.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Update the setup and usage docs when a change affects users, and the architecture or configuration examples when it affects operators. [Documentation map](AGENTS.md#keep-documentation-in-sync) · [Architecture and operations](docs/architecture.md) · [MIT license](LICENSE)
