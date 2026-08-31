# Enclave RP — Server Status

A standalone Discord bot (app id `1543975525448683580`) that watches the
Enclave RP FiveM server and posts bilingual (English / Arabic) alerts to
`#server-status` — with `@everyone` — whenever something changes:

- 🔴 the server **goes down**
- 🛠️ a **scheduled restart** is announced — automatically from **txAdmin's**
  own restart scheduler, or on demand via `/scheduled-restart`
- 🟢 the server **comes back up** — worded as "restart complete" instead of
  "back online" when it followed a scheduled restart within its grace window

## How it watches the server

Same approach as the `enclaverp.cc` homepage (`enclave-home/lib/fivem.js`):
the `FIVEM_JOIN_CODE` (`cfx.re/join/<code>`) is resolved to the server's
current address via Cfx.re's `x-citizenfx-url` header, then polled directly
(`/dynamic.json`) with the public Cfx.re server listing as a fallback for a
network that blocks the game port. The address follows the server if its IP
ever changes — nothing is hardcoded.

Every check (`CHECK_INTERVAL_MS`, default 60s) updates an in-memory
online/offline state machine:

- **`FAILURE_THRESHOLD`** consecutive failed checks before announcing the
  server down — absorbs one dropped check instead of crying wolf.
- **`RECOVERY_THRESHOLD`** consecutive successful checks before announcing it
  back up.
- The very first check after the bot starts only establishes a silent
  baseline — a restart of the bot itself never announces "back online".

## Scheduled restarts

There are two ways a restart gets announced, and both open the same grace
window (`RESTART_WINDOW_MINUTES`, default 30): the next down → up cycle
inside it is reported as *the announced restart* rather than an unplanned
outage, in both the down and the up message.

### Automatic, from txAdmin (the important one)

If the FiveM server runs txAdmin — it does, txAdmin ships with FXServer —
its own **Restart Scheduler** (Settings → General → Scheduled Restarts)
already fires internal events on a countdown before every restart it runs.
The [`txadmin_restart_relay`](fivem/txadmin_restart_relay) FiveM resource
listens for those and forwards them to this bot's relay endpoint
(`src/restartWebhook.js`), which turns them into the same bilingual
`@everyone` announcement — no staff action needed, no txAdmin-side Discord
setup at all.

txAdmin counts down at 30/15/10/5/4/3/2/1 minutes before the restart,
firing an event at every one of those marks; posting on all eight would
spam the channel, so only the minute marks in `RESTART_WEBHOOK_MILESTONES`
(default `15,1`) actually produce a message. If an admin cancels the
restart from the txAdmin panel, a quiet (no `@everyone`) cancellation
notice goes out too.

See [`fivem/txadmin_restart_relay/README.md`](fivem/txadmin_restart_relay/README.md)
for the game-server-side install (one resource folder + two lines in
`server.cfg`) and [`RESTART_WEBHOOK_*`](#configuration) below for the bot side.

### Manual, via `/scheduled-restart`

For anything txAdmin's scheduler doesn't cover — a one-off restart, a
maintenance window pushed from the panel directly rather than the
scheduler — staff run
`/scheduled-restart eta:"in 10 minutes" reason:"weekly update"` to post the
same announcement by hand. Requires **Manage Server**, or a role listed in
`STAFF_ROLE_ID`.

## `/status`

An on-demand, non-pinging check of the server's current state (online/offline,
player count, hostname) — for anyone to run at any time.

## Setup

```bash
npm ci
cp .env.example .env      # fill in DISCORD_TOKEN (see below)
npm run deploy            # register slash commands
npm start
```

For a Linux host running this alongside other Enclave bots, see
[`deploy/README.md`](deploy/README.md) (systemd unit, updates, permissions).

### Getting `DISCORD_TOKEN`

This bot already exists (application id `1543975525448683580`) — get its
token from the **Bot** tab at
<https://discord.com/developers/applications>, under that application, and
put it in `.env`. `CLIENT_ID`, `GUILD_ID`, `STATUS_CHANNEL_ID` and
`FIVEM_JOIN_CODE` in `.env.example` are already the real Enclave RP values.

### Bot permissions

**View Channel**, **Send Messages**, **Embed Links**, and — critically —
**Mention Everyone** on the status channel, or the `@everyone` in every
alert silently fails to notify anyone. See `deploy/README.md` for a ready
invite link. The bot never needs `Administrator`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token. Required. |
| `CLIENT_ID` | `1543975525448683580` | This bot's application id. |
| `GUILD_ID` | Enclave RP guild | Register commands instantly to one guild; the bot ignores interactions from any other. |
| `STATUS_CHANNEL_ID` | `1536824170720133150` | Where every alert is posted. |
| `STAFF_ROLE_ID` | empty | Role(s), comma-separated, additionally allowed to run `/scheduled-restart`. |
| `FIVEM_JOIN_CODE` | `zjjp6m4` | The `cfx.re/join/<code>` for the server being watched. |
| `CHECK_INTERVAL_MS` | `60000` | How often to check. |
| `FAILURE_THRESHOLD` | `2` | Consecutive failed checks before announcing "down". |
| `RECOVERY_THRESHOLD` | `1` | Consecutive successful checks before announcing "back up". |
| `RESTART_WINDOW_MINUTES` | `30` | How long after a restart announcement (automatic or manual) a down→up cycle counts as that restart. |
| `RESTART_WEBHOOK_PORT` | unset (disabled) | Port for the txAdmin relay endpoint. Unset = that automatic path is off; `/scheduled-restart` is unaffected either way. |
| `RESTART_WEBHOOK_HOST` | `127.0.0.1` | Interface the relay endpoint binds. Only widen if the game server is on a different host. |
| `RESTART_WEBHOOK_SECRET` | empty | Shared secret the relay resource authenticates with. Required for the endpoint to start. |
| `RESTART_WEBHOOK_MILESTONES` | `15,1` | Minutes-before-restart to actually post an alert for, out of txAdmin's fixed 30/15/10/5/4/3/2/1 countdown. |

## Notes

- **Stateless.** Everything (the debounce counters, the restart grace
  window) is in-memory; a restart of the bot just re-establishes the
  baseline on its next check. Nothing is written to disk. One consequence:
  the channel only ever shows the single most recent status message — every
  new one (down, up, scheduled-restart, restart-cancelled, from any source)
  deletes whichever one this bot posted before it, rather than piling up a
  history. A bot restart forgets which message that was, so the very next
  alert after a restart won't delete an older one, but everything after that
  goes back to replacing cleanly.
- **`@everyone` is deliberate here**, per the brief — unlike some of the
  other Enclave bots, which avoid it because ticket creation is
  member-triggered. This bot only pings on a real state change or an
  explicit staff command, both of which are exactly what `@everyone` exists
  for.
- **Runs alongside other Enclave bots.** `GUILD_ID` scopes interaction
  handling to the one guild, the same convention `enclave-tickets-bot` uses,
  so this token never needs to be the only bot in the server.
- **The relay endpoint is unauthenticated-off by design.** If
  `RESTART_WEBHOOK_SECRET` isn't set, `restartWebhook.start()` refuses to
  bind the port at all rather than listening without auth — a stray open
  HTTP port that lets anyone POST a fake "server restarting" `@everyone` is
  worse than the feature not running.

## Scripts

| Script | |
| --- | --- |
| `npm start` | Run the bot |
| `npm run deploy` | Register slash commands |
| `npm run check` | Syntax-check every source file |
