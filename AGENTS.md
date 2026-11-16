# Play Villa repository instructions

Play Villa has a Discord bot, a read-only companion site, and a Cloudflare Worker backed by D1. For a new installation, start with the [agent setup guide](docs/agent-setup.md) and [README setup](README.md#set-up-your-discord-server). Use the checked-in Wrangler file and example environment files as templates. Deployment settings belong in the installation’s ignored config and secrets belong in the deployment’s secret store.

## Keep documentation in sync

Update the relevant documentation in the same change as the feature. Check the Discord, website, operator, and agent experience whenever a change crosses those boundaries.

| Change touches | Update alongside it |
| --- | --- |
| Discord commands, permissions, or organizer and member behavior | The README [usage walkthrough](README.md#run-your-first-game-night), Discord command help in [worker/commands.ts](worker/commands.ts), and the [install verification steps](docs/setup.md#verify-a-fresh-installation-with-two-discord-accounts) when the steps change. |
| The companion site or its public data | The README feature summary, [companion setup](docs/setup.md#publish-the-companion-site), and the relevant site labels or help text. Update [.env.example](.env.example) when browser settings change. |
| Setup, secrets, or deployment commands | The README [human setup](README.md#set-up-your-discord-server), [agent setup](docs/agent-setup.md), and matching config or environment examples. Keep working examples free of deployment-specific IDs and credential values. |
| Scheduling rules, API behavior, migrations, or delivery | The [architecture and operations notes](docs/architecture.md) and the affected user or troubleshooting instructions. Document any operator action needed during an upgrade. |

Describe shipped behavior in setup and usage docs. Put proposals in a discussion or issue until they are implemented. Use the [local checks](README.md#develop-locally) and verify live Discord or public-site behavior when the change affects those paths.
