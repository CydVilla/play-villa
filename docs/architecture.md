# Architecture

Discord sends signed commands and component interactions to a TypeScript Cloudflare Worker. The Worker uses D1 as the shared source of truth. D1 transactions claim each mutation by Discord interaction ID and store votes, availability and RSVPs independently. Foreign keys constrain choices to their own session. The Worker checks guild and channel scope before exposing a session or accepting changes.

The existing React site remains static. Vite replaces Create React App and can build relative asset paths for GitHub Pages. A public read endpoint serves aggregate data exclusively for the opted-in guild and channel. The website contains no browser identity or privileged write path. Voting remains in Discord, so a browser login and its OAuth token storage are unnecessary.

A persistent Gateway process would add an always-on service and connection management. Discord HTTP interactions and cron cover the required features without that process. A GitHub Actions cron would still need an application endpoint and storage, and an always-on database server is unnecessary for this load. The Worker already hosts the API, so the same deployment can also serve the static assets.

## Scheduling and ballots

- Manual dates use the session time zone unless the input includes `Z` or a numeric UTC offset. Enter an explicit offset during repeated or skipped local times. Weekly rules advance skipped times by the clock change and take the earlier occurrence of repeated times.
- Manual voting defaults to three days after creation or one minute before the earliest proposed slot, whichever comes first. A custom deadline must precede all slots. Weekly rounds open and close on the configured local days and times. If cron misses an entire planning window, it skips that round.
- The vote winner has the most votes, with the earliest nomination winning ties. The time winner has the most availability among future slots, with the earliest start winning ties. Users who RSVP **Can’t attend** do not count toward slot recommendations until they change that RSVP. Choosing availability is separate from an RSVP. Capacity limits the number of **Going** responses, and availability does not reserve a seat.
- An organizer can confirm a nominated game and proposed future time even when a ballot has no recommendation, by choosing both in Discord. Automatic confirmation requires a game vote and availability at or above the quorum. Below quorum, the round closes and waits for a decision.
- Members can propose extra times while voting is open. A session supports ten slots and 24 games, leaving a Discord select option for vote retraction. Existing time choices are preserved on edits. To change a confirmed game or start time, cancel and create a replacement.
- Browser-local records from the old site cannot establish a verified voter identity or a shared history. The new deployment starts with its own clean database.

## Delivery

A D1 trigger records an outbox entry in the same transaction as each session transition. A Worker cron checks due entries every minute, and manual commands also try immediate delivery. The weekly key is unique per guild and opening date. Durable leases and deterministic Discord nonces protect against overlapping dispatch. Rate limits use Discord’s retry timing. Superseded posts and reminders past the event start are skipped. Mentions and automatic push notifications are suppressed.

If Discord may have accepted a post, the Worker looks for its bot-authored delivery marker in recent channel history before recording the message ID. An ambiguous send that cannot be verified is marked blocked after the reconciliation window to avoid double-posting. Use `/gamenight delivery-status` and inspect the channel history and Worker logs. A database operator can requeue a blocked entry by resetting its `state` to `pending`, clearing `attempted_at`, `lease_until`, `claim`, and `error`, and setting `next_at` to the current Unix time. Do this only after confirming the marked message did not reach the channel. The channel posts are snapshots, while **View details** reads live totals and attendees.

Discord Scheduled Events and website voting are intentionally omitted from this version. The bot posts the confirmed time, a voice link when set, and the companion generates calendar links. Creating managed Discord Scheduled Events would require extra permissions and a separate reconciliation strategy.

## Limits and validation

The Free plan targets small communities. One cron runs every minute and processes up to three due weekly configurations, twelve expired polls, and three pending channel deliveries per invocation. A D1 database puts a single writer behind the transaction guarantees. Multi-server operators should watch delivery lag, Worker CPU, D1 reads and writes, and the upstream RAWG quota before broadening distribution. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)

Tests exercise the migration and transactions using real SQLite, with Discord HTTP responses stubbed. The Worker/Discord portal handshake, guild installation, channel permissions, and delivery under the deployed account’s quotas need a live check during installation.
