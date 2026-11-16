# Setup options and troubleshooting

Follow the [single-server setup in the README](../README.md#set-up-your-discord-server) to get a working bot. The options below can be added after you’ve run a test poll.

## Upgrade an existing installation

Use your existing ignored `wrangler.local.toml` and confirm it points to the intended Worker and D1 database. Build the site, apply the new migration, and deploy the Worker in order.

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --remote --config wrangler.local.toml
npx wrangler deploy --config wrangler.local.toml
```

Register the updated slash command with `npm run discord:register`. For an existing global install, use `npm run discord:register -- --global`. Provide the Discord application credentials temporarily using the [README’s registration steps](../README.md#5-store-the-token-and-register-the-command) or a local secret manager. The deployed Worker continues to use its existing secret. The migration preserves existing polls, votes, RSVPs, and delivery records. You can keep using old boards until the corresponding game night is rescheduled.

## Enable Discord Events

Grant the bot’s role **Create Events** at the server level. Then run `/gamenight configure` with **discord_events** set to true. Newly confirmed nights get a server event that links to the voice channel, or to the announcement channel if no voice channel is set. Play Villa updates that event when the night moves and closes it when the night is cancelled. Check **View details** or the companion for the event link once Discord has accepted it. [Discord Event permissions](https://docs.discord.com/developers/resources/guild-scheduled-event#guild-scheduled-event-permissions-requirements)

Enable this for nights intended to appear in the server’s Events tab. Set **discord_events** to false to stop publishing new events. Existing Play Villa events continue to follow their sessions. Use `/gamenight delivery-status` if an event is missing or delayed.

## Publish the companion site

The Worker hosts a read-only website. Its schedule is disabled until you add both values below under the existing `[vars]` in `wrangler.local.toml` and redeploy. Use the configured announcement channel for the public schedule. With Discord Developer Mode enabled, right-click the channel and select **Copy Channel ID**.

```toml
PUBLIC_GUILD_ID = "YOUR_SERVER_ID"
PUBLIC_CHANNEL_ID = "YOUR_ANNOUNCEMENT_CHANNEL_ID"
```

Anyone with the site URL can view schedule entries for that channel, including titles, descriptions, nominations and tags, aggregate RSVP and waitlist counts, and Discord links. Choose a channel you’re comfortable publishing. To turn off the public schedule, remove both variables and redeploy. [Public data and access](architecture.md)

For site branding, copy `.env.example` to `.env.local` and edit `VITE_COMMUNITY_NAME`. You can also add a Discord invite, donation link, or affiliate tag. Treat all `VITE_*` values as public because Vite puts them into the site build. Leave `VITE_API_URL` empty to serve the site from the Worker.

```sh
npm run build
npx wrangler deploy --config wrangler.local.toml
```

## Enable game search

Create an API key in RAWG and run the command below. Members can use `/gamenight search` to get a result ID and enter it in the **rawg_id** field of `/gamenight nominate`. Custom nominations are available with or without this key. [RAWG API terms](https://rawg.io/tos_api)

```sh
npx wrangler secret put RAWG_API_KEY --config wrangler.local.toml
```

## Optional GitHub Pages companion

In the site’s `.env.local`, set `VITE_API_URL` to the deployed Worker origin, such as `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`. Build and publish `dist/` to GitHub Pages. In `wrangler.local.toml`, keep the two public schedule variables and set `WEB_ORIGIN` under `[vars]` to the exact Pages origin. It should include the scheme and hostname, such as `https://YOUR-ACCOUNT.github.io`, with no path or trailing slash. Redeploy the Worker after changing its config.

## More than one server

For a shared installation, remove `DISCORD_GUILD_ID` from both `wrangler.local.toml` and the local registration environment, redeploy the Worker, and register the command with `npm run discord:register -- --global`. Install the Discord app and run `/gamenight configure` in each server. Server settings and ballots are scoped by guild. A public companion still shows only the chosen guild and channel.

## Verify a fresh installation with two Discord accounts

1. As a server manager, configure a test text channel and create a session with two future slots. Confirm it receives one board and the companion shows the same session if public access is enabled.
2. As a member, nominate a game, vote, switch votes, retract, and vote again. Select both times and change the selection to one. Cycle through RSVP statuses and check **View details**.
3. Check that the member cannot cancel or confirm. As the organizer, close voting, check the recommendations, and confirm with or without an override. Verify one confirmation, the voice link if set, and the start and end of the calendar export if the companion is enabled.
4. With **capacity** set to 1, have the first account select Going and the second join the waitlist. Free the seat with Maybe. Verify the second account is tagged for the offer and can claim it. Move the night with `/gamenight reschedule`. Check that the new board asks for an RSVP and, when the companion is enabled, the calendar export uses the new time.
5. If you enabled Discord Events, confirm that the event appears in the server’s Events tab, moves with the session, and closes when the session is cancelled.
6. If you enable weekly scheduling, set up a short test window and confirm that one round opens. Test reminder delivery, then cancel a separate test session before its reminder and check that the reminder is suppressed. Use `/gamenight delivery-status` to see the delivery record.
7. Cancel any open test sessions. If replacing an older client-side integration, rotate any webhook or API key that was included in a browser build before publishing the replacement.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Discord won’t save the interactions endpoint | Open the Worker’s `/health` URL and check for `{"ok":true}`. Use the exact `/discord/interactions` path and confirm that the application ID and public key in the Worker config are from the app you’re editing. Redeploy if you change them. |
| Play Villa is installed, but `/gamenight` is missing | Run `npm run discord:register` from the project folder. Check that `.dev.vars` has the application and server IDs and the bot token for that app. Refresh Discord, then check the server’s app permissions and whether the member can **Use Application Commands**. |
| Command registration returns HTTP 401 or 403 | For a 401, check the bot token. For a 403, confirm the app was installed in the same server whose ID you used and that the install included `applications.commands`. |
| A command works, but the board is missing | Check that the Worker has the `DISCORD_BOT_TOKEN` secret and the bot has **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in the announcement channel. Inspect `/gamenight delivery-status` for the session. |
| A confirmed night has no Discord Event | Check **discord_events**, the bot’s **Create Events** permission, and the event entry in `/gamenight delivery-status`. |
| The site opens without a schedule | Check the [public schedule settings](#publish-the-companion-site). An API response of 404 is expected when public access is disabled. For Pages, check both `VITE_API_URL` on the site and `WEB_ORIGIN` on the Worker. |
| A date is rejected | Pick a future date in the configured time zone. Give the voting deadline before the earliest slot. Include a UTC offset if a local hour occurs twice or is skipped during a clock change. |
