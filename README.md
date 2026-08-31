# Enclave RP — Server Status

A standalone Discord bot (app id `1543975525448683580`) that watches the
Enclave RP FiveM server and posts bilingual (English / Arabic) alerts to
`#server-status` — with `@everyone` — whenever something changes:

- 🔴 the server **goes down**
- 🛠️ a **scheduled restart** is announced (staff-triggered)
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

## `/scheduled-restart`

Staff run `/scheduled-restart eta:"in 10 minutes" reason:"weekly update"` to
post the restart announcement. That also opens a grace window
(`RESTART_WINDOW_MINUTES`, default 30): the next down → up cycle inside that
window is reported as *the announced restart* rather than an unplanned
outage, in both the down and the up message.

Requires **Manage Server**, or a role listed in `STAFF_ROLE_ID`.

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
| `FIVEM_JOIN_CODE` | `dggpkvq` | The `cfx.re/join/<code>` for the server being watched. |
| `CHECK_INTERVAL_MS` | `60000` | How often to check. |
| `FAILURE_THRESHOLD` | `2` | Consecutive failed checks before announcing "down". |
| `RECOVERY_THRESHOLD` | `1` | Consecutive successful checks before announcing "back up". |
| `RESTART_WINDOW_MINUTES` | `30` | How long after `/scheduled-restart` a down→up cycle counts as that restart. |

## Notes

- **Stateless.** Everything (the debounce counters, the restart grace
  window) is in-memory; a restart of the bot just re-establishes the
  baseline on its next check. Nothing is written to disk.
- **`@everyone` is deliberate here**, per the brief — unlike some of the
  other Enclave bots, which avoid it because ticket creation is
  member-triggered. This bot only pings on a real state change or an
  explicit staff command, both of which are exactly what `@everyone` exists
  for.
- **Runs alongside other Enclave bots.** `GUILD_ID` scopes interaction
  handling to the one guild, the same convention `enclave-tickets-bot` uses,
  so this token never needs to be the only bot in the server.

## Scripts

| Script | |
| --- | --- |
| `npm start` | Run the bot |
| `npm run deploy` | Register slash commands |
| `npm run check` | Syntax-check every source file |
