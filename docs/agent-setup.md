# Set up Play Villa with an agent

This guide is for an agent helping a server owner install or maintain Play Villa. Read the [README setup](../README.md#set-up-your-discord-server), [setup options](setup.md), and [repository instructions](../AGENTS.md) first. Use the README as the source of truth for the install order and commands.

A user can give an agent this request:

> Set up this Play Villa repo for my Discord server. Use the single-server setup first. Tell me when I need to sign in or enter a credential, and verify a test poll in the channel we choose. Keep the schedule private unless I ask to publish it.

## Identify the installation

- Check the working tree, `wrangler.local.toml` if present, and the authenticated Cloudflare context. Reuse the intended resources for an existing install. For a new install, use distinct Worker and D1 names in the user’s account.
- Establish the target Discord server, announcement channel, and time zone from the request or existing settings. Use the server ID, application ID, and public signing key in the ignored Wrangler config. The server owner can find the server and channel IDs with Developer Mode.
- Use the user’s authorization for deployment and Discord actions. Keep the initial install scoped to the intended guild. Enable public schedule variables only when the user wants the named channel’s schedule published. Enable Discord Events and add the bot’s Create Events permission when the owner wants sessions in the server’s Events tab.

## Coordinate the steps that need the owner

Follow the [README’s Discord and Cloudflare setup](../README.md#set-up-your-discord-server). Prepare values and commands ahead of account steps. The owner can sign in, accept third-party terms, authorize the Discord installation, and enter a bot token when those steps require their access.

A bot token can go directly into the interactive Wrangler secret prompt and the ignored local registration file, or through the owner’s existing secret manager into the registration process. Use `DISCORD_BOT_TOKEN` as the Worker secret name. Keep token values out of chat, command arguments, logs, screenshots, and commits. Clear a temporary token value from `.dev.vars` after registration. Keep `RAWG_API_KEY` optional and server-side. Clear any real identifiers from examples intended for contributors.

If the owner wants catalog search, use the [RAWG setup steps](setup.md#enable-game-search) and have them enter their own key at the Wrangler prompt. For a local Worker, keep the key in the ignored `.dev.vars` file or the owner’s local secret manager.

For an installed bot, follow the [upgrade steps](setup.md#upgrade-an-existing-installation) when a change adds migrations or Discord commands. For remote commands, pass the ignored config path explicitly. Verify that its Worker name, `DB` binding, and database ID match the intended deployment before running a remote migration or upload. Run local development with `npm run db:local` and `npm run dev:worker`.

## Verify and hand off

1. Run the relevant checks from [Develop locally](../README.md#develop-locally). For a deployment, check the built Worker before applying migrations or uploading when appropriate. `npx wrangler deploy --dry-run --config wrangler.local.toml` bundles the Worker without deploying it.
2. Verify that the deployed `/health` responds, Discord accepts the signed endpoint, and `/gamenight` appears for the target guild. Check the app’s channel permissions if setup succeeds but announcements fail.
3. Run a clearly labeled test using the [Discord verification steps](setup.md#verify-a-fresh-installation-with-two-discord-accounts). Use the date and time dropdowns on `/gamenight create` and verify the command response and announcement. With a RAWG key, check that entering an exact catalog title in **game** imports its details. Test a manual nomination with a note. Use `/gamenight search` with only **query** when one ballot is open, pick a result, and confirm that game. Check its details on the Discord confirmation and on the companion if enabled. For an upgrade, also test a reschedule and a waitlist offer, then check the native event when enabled. If a user interaction is required to complete the test, report any part still unverified.
4. Report the Worker URL, chosen channel and time zone, what was tested, and any optional settings that were enabled. For a private inventory, record resource names, IDs, and secret references. Use placeholders for public docs and examples.

When adding a feature, use the [documentation map](../AGENTS.md#keep-documentation-in-sync) to update the public instructions and agent guidance together.
